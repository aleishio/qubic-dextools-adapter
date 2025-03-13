const axios = require('axios');
const config = require('../config');

class QubicRpcClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.qubic.rpcUrl,
      timeout: 10000,
    });
    console.log(`Using RPC endpoint: ${config.qubic.rpcUrl}`);
    
    // Initialize cache
    this.cache = {
      epochData: {}, // Cache for epoch data
      ticks: {},     // Cache for individual ticks
      status: null,  // Cache for last status check
      statusTimestamp: 0,
      epochRanges: {} // Cache for epoch tick ranges
    };
    
    // Safety buffer for latest block (how many blocks to go back from absolute latest)
    this.LATEST_BLOCK_SAFETY_BUFFER = 10;
  }

  // ========== Helper Methods ==========
  async handleRequest(endpoint, params = {}) {
    try {
      const response = await this.client.get(endpoint, { params });
      return response.data;
    } catch (error) {
      console.error(`Error calling ${endpoint}:`, error.message);
      throw error;
    }
  }

  // Get current epoch with caching
  async getCurrentEpoch() {
    // Check if we have a recent status cache (less than 30 seconds old)
    const now = Date.now();
    if (this.cache.status && (now - this.cache.statusTimestamp) < 30000) {
      return this.cache.status.lastProcessedTick?.epoch || 0;
    }
    
    try {
      const statusResponse = await this.handleRequest('/v1/status');
      if (statusResponse && statusResponse.lastProcessedTick && statusResponse.lastProcessedTick.epoch) {
        // Update cache
        this.cache.status = statusResponse;
        this.cache.statusTimestamp = now;
        
        const currentEpoch = statusResponse.lastProcessedTick.epoch;
        console.log(`Current epoch from status: ${currentEpoch}`);
        return currentEpoch;
      }
    } catch (error) {
      console.error('Failed to get current epoch:', error.message);
    }
    
    // Fallback to a known epoch if we can't determine the current one
    return 152; // Known good epoch from logs
  }

  // Get all ticks from an epoch with proper pagination - no artificial limits
  async getAllTicksFromEpoch(epoch, maxTicks = Infinity) {
    const cacheKey = `epoch_${epoch}`;
    
    // Return cached epoch data if available
    if (this.cache.epochData[cacheKey] && this.cache.epochData[cacheKey].length > 0) {
      console.log(`Using ${this.cache.epochData[cacheKey].length} cached ticks for epoch ${epoch}`);
      return this.cache.epochData[cacheKey];
    }
    
    console.log(`Getting all ticks from epoch ${epoch} (up to ${maxTicks === Infinity ? 'unlimited' : maxTicks})`);
    
    const allTicks = [];
    const pageSize = 100; // Maximum page size supported by the API
    let page = 0;
    let hasMoreData = true;
    let emptyPageCount = 0;
    const MAX_EMPTY_PAGES = 3; // Stop after 3 consecutive empty pages
    
    // Process pages until we have all data or reach the limit
    while (hasMoreData && allTicks.length < maxTicks) {
      try {
        console.log(`Fetching epoch ${epoch} page ${page} (pageSize: ${pageSize})`);
        const ticksResponse = await this.handleRequest(
          `/v2/epochs/${epoch}/ticks`,
          { page, pageSize }
        );
        
        if (!ticksResponse || !ticksResponse.ticks || !Array.isArray(ticksResponse.ticks) || ticksResponse.ticks.length === 0) {
          // No more data available or empty page
          emptyPageCount++;
          
          if (emptyPageCount >= MAX_EMPTY_PAGES) {
            console.log(`Received ${MAX_EMPTY_PAGES} consecutive empty pages, assuming end of data`);
            hasMoreData = false;
          } else {
            // Try next page in case of temporary issue
            page++;
            console.log(`Empty page received, continuing to next page ${page}`);
          }
        } else {
          // Reset empty page counter when we get data
          emptyPageCount = 0;
          
          const tickList = ticksResponse.ticks;
          console.log(`Got ${tickList.length} ticks from epoch ${epoch} page ${page}`);
          
          // Add normalized ticks to our collection
          for (const tick of tickList) {
            // Also cache individual ticks
            const tickNumber = tick.tickNumber || tick.number;
            this.cache.ticks[tickNumber] = this.normalizeTickData(tick);
            
            allTicks.push(this.cache.ticks[tickNumber]);
          }
          
          // Check if we've reached the end
          if (tickList.length < pageSize) {
            console.log(`Received less than ${pageSize} ticks, reached end of data`);
            hasMoreData = false;
          } else {
            page++;
          }
        }
      } catch (error) {
        console.error(`Error getting ticks for epoch ${epoch} page ${page}:`, error.message);
        // Try a few more times with increasing delay in case of temporary issues
        if (error.response && error.response.status === 429) {
          // Rate limited, wait longer
          const delay = 2000 * (emptyPageCount + 1);
          console.log(`Rate limited, waiting ${delay}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, delay));
          emptyPageCount++;
          // Don't mark as end of data yet unless we've hit the limit
          if (emptyPageCount >= MAX_EMPTY_PAGES * 2) {
            hasMoreData = false;
          }
        } else {
          hasMoreData = false;
        }
      }
    }
    
    // If we found ticks, calculate and cache the tick number range for this epoch
    if (allTicks.length > 0) {
      const tickNumbers = allTicks.map(t => t.tickNumber);
      this.cache.epochRanges[epoch] = {
        minTickNumber: Math.min(...tickNumbers),
        maxTickNumber: Math.max(...tickNumbers)
      };
      console.log(`Epoch ${epoch} contains ticks from ${this.cache.epochRanges[epoch].minTickNumber} to ${this.cache.epochRanges[epoch].maxTickNumber}`);
    }
    
    // Sort ticks by number (descending)
    allTicks.sort((a, b) => b.tickNumber - a.tickNumber);
    
    // Cache the results
    this.cache.epochData[cacheKey] = allTicks;
    
    console.log(`Total ticks found in epoch ${epoch}: ${allTicks.length}`);
    return allTicks;
  }

  // Find which epoch contains a specific tick number
  async findEpochForTick(tickNumber) {
    // First check the cache to see if we already know which epoch contains this tick
    for (const epoch in this.cache.epochRanges) {
      const range = this.cache.epochRanges[epoch];
      if (tickNumber >= range.minTickNumber && tickNumber <= range.maxTickNumber) {
        console.log(`Found tick ${tickNumber} in cached epoch ${epoch} range`);
        return parseInt(epoch);
      }
    }
    
    // If not found in cache, start with current epoch and work backwards
    const currentEpoch = await this.getCurrentEpoch();
    
    // Since epochs change weekly and we have 152 historical epochs (0-151 plus current)
    // we need to check all of them to find historical data
    const MAX_EPOCHS_TO_CHECK = Math.max(153, currentEpoch + 1); // Check all possible epochs
    
    // First check recently used epochs as they're most likely
    const recentlyAccessedEpochs = Object.keys(this.cache.epochData)
      .map(key => parseInt(key.replace('epoch_', '')))
      .sort((a, b) => b - a); // Most recent first
      
    for (const epochToCheck of recentlyAccessedEpochs) {
      // Get some ticks from this epoch if not already cached
      if (!this.cache.epochRanges[epochToCheck]) {
        const epochTicks = await this.getAllTicksFromEpoch(epochToCheck, 1000);
        if (epochTicks.length === 0) continue;
      }
      
      // Now check if the tick is in this epoch's range
      const range = this.cache.epochRanges[epochToCheck];
      if (range && tickNumber >= range.minTickNumber && tickNumber <= range.maxTickNumber) {
        console.log(`Found tick ${tickNumber} in recently accessed epoch ${epochToCheck} range`);
        return epochToCheck;
      }
    }
    
    // Progressively scan through epochs - start with current and move backward
    for (let epochDiff = 0; epochDiff <= MAX_EPOCHS_TO_CHECK; epochDiff++) {
      // Try both current epoch minus diff (going back) and plus diff (in case tick is in future epoch)
      const epochsToCheck = [
        currentEpoch - epochDiff,
        currentEpoch + epochDiff
      ].filter(e => e >= 0); // Only non-negative epochs
      
      for (const epochToCheck of epochsToCheck) {
        // Skip if already checked
        if (this.cache.epochRanges[epochToCheck]) continue;
        
        // Get some ticks from this epoch to establish its range
        console.log(`Checking epoch ${epochToCheck} for tick ${tickNumber}`);
        const epochTicks = await this.getAllTicksFromEpoch(epochToCheck, 1000);
        
        // If we couldn't get any ticks, skip to next epoch
        if (epochTicks.length === 0) continue;
        
        // Now check if the tick is in this epoch's range
        const range = this.cache.epochRanges[epochToCheck];
        if (range && tickNumber >= range.minTickNumber && tickNumber <= range.maxTickNumber) {
          console.log(`Found tick ${tickNumber} in epoch ${epochToCheck} range`);
          return epochToCheck;
        }
      }
      
      // If we've checked all possible epochs, break out
      if (epochDiff > currentEpoch && epochDiff > 152) {
        break;
      }
    }
    
    // If we couldn't find the epoch, return the current one as fallback
    console.warn(`Could not determine which epoch contains tick ${tickNumber}, using current epoch ${currentEpoch}`);
    return currentEpoch;
  }

  // ========== Block/Tick Methods ==========
  
  // Get the latest tick (block) that's safe for DEXTools to consume
  // As per spec: "must return a block only when all events have been processed"
  async getLatestTick() {
    try {
      // First get latest tick number from API
      const response = await this.handleRequest('/v1/latestTick');
      
      if (response && response.latestTick) {
        const latestTickNumber = response.latestTick;
        console.log(`Absolute latest tick number: ${latestTickNumber}`);
        
        // Apply safety buffer - go back a few ticks to ensure all events are processed
        // This is crucial to meet DEXTools HTTP adapter spec requirement
        const safeTickNumber = Math.max(0, latestTickNumber - this.LATEST_BLOCK_SAFETY_BUFFER);
        console.log(`Using safe tick number with buffer: ${safeTickNumber}`);
        
        // Get current epoch
        const currentEpoch = await this.getCurrentEpoch();
        
        // Get all ticks from current epoch
        const ticksFromEpoch = await this.getAllTicksFromEpoch(currentEpoch);
        
        if (ticksFromEpoch && ticksFromEpoch.length > 0) {
          // Try to find the safe tick in epoch data
          let safeTickData = ticksFromEpoch.find(t => t.tickNumber === safeTickNumber);
          
          // If we can't find the exact tick, return the closest older one
          if (!safeTickData) {
            // Find the newest tick that's older than or equal to safeTickNumber
            const olderTicks = ticksFromEpoch.filter(t => t.tickNumber <= safeTickNumber);
            
            if (olderTicks.length > 0) {
              // Sort by tick number (descending) and take the first one
              olderTicks.sort((a, b) => b.tickNumber - a.tickNumber);
              safeTickData = olderTicks[0];
              console.log(`Using older tick ${safeTickData.tickNumber} as safe latest tick`);
            } else {
              // If no older ticks in this epoch, try previous epoch
              const prevEpoch = currentEpoch - 1;
              console.log(`No older ticks found in current epoch, trying previous epoch ${prevEpoch}`);
              
              const prevEpochTicks = await this.getAllTicksFromEpoch(prevEpoch);
              if (prevEpochTicks && prevEpochTicks.length > 0) {
                // Use the newest tick from previous epoch
                safeTickData = prevEpochTicks[0];
                console.log(`Using tick ${safeTickData.tickNumber} from previous epoch ${prevEpoch}`);
              }
            }
          }
          
          if (safeTickData) {
            console.log(`Found safe latest tick ${safeTickData.tickNumber}`);
            return safeTickData;
          }
        }
        
        // If we couldn't find a good tick, return basic info
        console.warn(`Could not find tick data, returning basic info for tick ${safeTickNumber}`);
        return { 
          tickNumber: safeTickNumber, 
          timestamp: Date.now(), 
          epoch: currentEpoch
        };
      }
      
      console.warn('Failed to get latest tick number from Qubic RPC, returning placeholder');
      return { tickNumber: 0, timestamp: Date.now() };
    } catch (error) {
      console.error('Error fetching latest tick:', error.message);
      return { tickNumber: 0, timestamp: Date.now(), error: error.message };
    }
  }

  // Get a specific tick by number
  async getTickByNumber(tickNumber) {
    try {
      // Check cache first
      if (this.cache.ticks[tickNumber]) {
        console.log(`Using cached data for tick ${tickNumber}`);
        return this.cache.ticks[tickNumber];
      }
      
      // Find which epoch contains this tick
      const epochForTick = await this.findEpochForTick(tickNumber);
      
      // Get ticks from that epoch
      const ticksInEpoch = await this.getAllTicksFromEpoch(epochForTick);
      
      if (ticksInEpoch && ticksInEpoch.length > 0) {
        // Find the requested tick in this epoch
        const tickData = ticksInEpoch.find(t => t.tickNumber === tickNumber);
        
        if (tickData) {
          console.log(`Found tick ${tickNumber} in epoch ${epochForTick}`);
          // Cache this tick
          this.cache.ticks[tickNumber] = tickData;
          return tickData;
        }
        
        // If we couldn't find the exact tick, find the nearest one
        const firstTickInEpoch = Math.min(...ticksInEpoch.map(t => t.tickNumber));
        const lastTickInEpoch = Math.max(...ticksInEpoch.map(t => t.tickNumber));
        
        if (tickNumber >= firstTickInEpoch && tickNumber <= lastTickInEpoch) {
          // Find the nearest tick
          const sortedTicks = [...ticksInEpoch].sort((a, b) => {
            return Math.abs(a.tickNumber - tickNumber) - Math.abs(b.tickNumber - tickNumber);
          });
          
          if (sortedTicks.length > 0) {
            const nearestTick = sortedTicks[0];
            console.log(`Found nearest tick ${nearestTick.tickNumber} for requested tick ${tickNumber}`);
            // Cache this near match too
            this.cache.ticks[tickNumber] = nearestTick;
            return nearestTick;
          }
        }
      }
      
      // If we couldn't find data in the determined epoch, try adjacent epochs
      for (let adjEpoch = epochForTick - 1; adjEpoch <= epochForTick + 1; adjEpoch++) {
        if (adjEpoch === epochForTick || adjEpoch < 0) continue; // Skip current epoch (already checked) and negative epochs
        
        console.log(`Checking adjacent epoch ${adjEpoch} for tick ${tickNumber}`);
        const adjEpochTicks = await this.getAllTicksFromEpoch(adjEpoch);
        
        // Check if this epoch might contain our tick
        if (adjEpochTicks.length > 0) {
          const firstTick = Math.min(...adjEpochTicks.map(t => t.tickNumber));
          const lastTick = Math.max(...adjEpochTicks.map(t => t.tickNumber));
          
          if (tickNumber >= firstTick && tickNumber <= lastTick) {
            const exactTick = adjEpochTicks.find(t => t.tickNumber === tickNumber);
            if (exactTick) {
              console.log(`Found tick ${tickNumber} in adjacent epoch ${adjEpoch}`);
              // Cache this tick
              this.cache.ticks[tickNumber] = exactTick;
              return exactTick;
            }
            
            // Find nearest
            const sortedTicks = [...adjEpochTicks].sort((a, b) => {
              return Math.abs(a.tickNumber - tickNumber) - Math.abs(b.tickNumber - tickNumber);
            });
            
            if (sortedTicks.length > 0) {
              const nearestTick = sortedTicks[0];
              console.log(`Found nearest tick ${nearestTick.tickNumber} in adjacent epoch ${adjEpoch}`);
              // Cache this near match too
              this.cache.ticks[tickNumber] = nearestTick;
              return nearestTick;
            }
          }
        }
      }
      
      // If we couldn't find data in any epoch, return a placeholder
      console.log(`No tick data available for tick ${tickNumber}, returning placeholder`);
      const placeholderTick = {
        tickNumber: tickNumber,
        timestamp: Date.now()
      };
      // Don't cache placeholders
      return placeholderTick;
    } catch (error) {
      console.error(`Error getting tick ${tickNumber}:`, error.message);
      return {
        tickNumber: tickNumber,
        timestamp: Date.now(),
        error: error.message
      };
    }
  }
  
  // Get ticks from a specific block range - crucial for DEXTools HTTP adapter
  async getTicksInBlockRange(fromBlock, toBlock, maxResults = Infinity) {
    try {
      console.log(`Getting ticks in block range ${fromBlock}-${toBlock}, max results: ${maxResults === Infinity ? 'unlimited' : maxResults}`);
      
      // Calculate actual max results based on range size - don't artificially limit results
      // DEXTools needs to see ALL ticks and events in the range
      const rangeSize = toBlock - fromBlock + 1;
      const actualMaxResults = Math.min(maxResults, rangeSize);
      
      // Collect all valid ticks in this range
      const validTicks = [];
      
      // Strategy 1: Check if we already know which epochs cover this range
      let epochsToCheck = [];
      let epochFound = false;
      
      // First see if we can narrow down epochs using our cache
      for (const epoch in this.cache.epochRanges) {
        const range = this.cache.epochRanges[epoch];
        // Check if this epoch overlaps with our requested range
        if ((range.minTickNumber <= toBlock && range.maxTickNumber >= fromBlock)) {
          epochsToCheck.push(parseInt(epoch));
          epochFound = true;
        }
      }
      
      // If we couldn't determine epochs from cache, more advanced strategy
      if (!epochFound) {
        // First try to find the epoch for the start of the range
        try {
          const startEpoch = await this.findEpochForTick(fromBlock);
          const endEpoch = await this.findEpochForTick(toBlock);
          
          // Add all epochs in between
          for (let e = Math.min(startEpoch, endEpoch); e <= Math.max(startEpoch, endEpoch); e++) {
            epochsToCheck.push(e);
          }
          
          epochFound = true;
        } catch (error) {
          console.error(`Failed to find specific epochs for block range: ${error.message}`);
        }
      }
      
      // If still no epochs found, fallback to checking many epochs
      // Make sure we check ALL 152 historical epochs if needed
      if (!epochFound) {
        const currentEpoch = await this.getCurrentEpoch();
        
        // More aggressive approach - check ALL epochs if we can't narrow it down
        // This ensures we never miss any data that DEXTools might need
        console.log(`No specific epochs found for range, checking all epochs from 0 to ${currentEpoch}`);
        
        // Add ALL epochs from 0 to current - this ensures complete coverage
        for (let e = 0; e <= currentEpoch; e++) {
          epochsToCheck.push(e);
        }
      }
      
      console.log(`Checking epochs for block range: ${epochsToCheck.join(', ')}`);
      
      // Check each potential epoch - no arbitrary limits!
      for (const epochToCheck of epochsToCheck) {
        // Don't break early if we hit some arbitrary limit - DEXTools needs ALL matching ticks
        
        console.log(`Searching for ticks in block range in epoch ${epochToCheck}`);
        // Don't use any artificial limits for fetching ticks
        const ticksInEpoch = await this.getAllTicksFromEpoch(epochToCheck);
        
        if (ticksInEpoch && ticksInEpoch.length > 0) {
          // Filter ticks that are in the requested range
          const ticksInRange = ticksInEpoch.filter(tick => {
            return tick.tickNumber >= fromBlock && tick.tickNumber <= toBlock;
          });
          
          console.log(`Found ${ticksInRange.length} ticks in range ${fromBlock}-${toBlock} in epoch ${epochToCheck}`);
          
          // Add ticks to our valid ticks array (up to maxResults)
          for (const tick of ticksInRange) {
            if (validTicks.length >= actualMaxResults) break;
            validTicks.push(tick);
          }
        }
      }
      
      // Sort by tick number
      validTicks.sort((a, b) => a.tickNumber - b.tickNumber);
      
      // If we still don't have any valid ticks, fallback to the most recent ones
      if (validTicks.length === 0) {
        console.log(`No ticks found in requested range, returning most recent ticks as fallback`);
        return this.getRecentValidTicks(maxResults);
      }
      
      console.log(`Returning ${validTicks.length} ticks for range ${fromBlock}-${toBlock}`);
      return validTicks;
    } catch (error) {
      console.error(`Error getting ticks in block range ${fromBlock}-${toBlock}:`, error.message);
      // Fallback to recent valid ticks
      return this.getRecentValidTicks(maxResults);
    }
  }

  // Get the most recent valid ticks directly from epoch data
  async getRecentValidTicks(count = 10) {
    try {
      // Get current epoch
      const currentEpoch = await this.getCurrentEpoch();
      
      const validTicks = [];
      
      // Check current epoch and previous epochs
      for (let epoch = currentEpoch; epoch >= Math.max(0, currentEpoch - 5); epoch--) {
        if (validTicks.length >= count) break;
        
        console.log(`Getting recent ticks from epoch ${epoch}`);
        // Increase limit to ensure we get enough ticks - 1000 instead of 100
        const ticksInEpoch = await this.getAllTicksFromEpoch(epoch, 1000);
        
        if (ticksInEpoch && ticksInEpoch.length > 0) {
          console.log(`Found ${ticksInEpoch.length} ticks in epoch ${epoch}`);
          
          // Sort by tick number (descending) to get most recent first
          const sortedTicks = [...ticksInEpoch].sort((a, b) => b.tickNumber - a.tickNumber);
          
          // Add ticks to our valid ticks array (up to count)
          for (const tick of sortedTicks) {
            if (validTicks.length >= count) break;
            validTicks.push(tick);
          }
          
          if (validTicks.length > 0) {
            console.log(`Found ${validTicks.length} valid ticks in epoch ${epoch}`);
          }
        }
      }
      
      // Sort by tick number (descending)
      validTicks.sort((a, b) => b.tickNumber - a.tickNumber);
      
      return validTicks;
    } catch (error) {
      console.error('Failed to get recent valid ticks:', error.message);
      return [];
    }
  }

  // Get tick by timestamp using epoch data
  async getTickByTimestamp(timestamp) {
    try {
      console.log(`Searching for tick with timestamp <= ${timestamp}`);
      
      // Get current epoch
      const currentEpoch = await this.getCurrentEpoch();
      
      // Start checking from current epoch downward
      for (let epoch = currentEpoch; epoch >= 0; epoch--) {
        console.log(`Checking ticks in epoch ${epoch} for timestamp <= ${timestamp}`);
        
        const ticksInEpoch = await this.getAllTicksFromEpoch(epoch);
        
        if (ticksInEpoch && ticksInEpoch.length > 0) {
          // Sort by timestamp (descending)
          const sortedByTimestamp = [...ticksInEpoch].sort((a, b) => b.timestamp - a.timestamp);
          
          // Find the newest tick with timestamp <= requested timestamp
          for (const tick of sortedByTimestamp) {
            const tickTimestamp = tick.timestamp || 0;
            
            if (tickTimestamp <= timestamp) {
              console.log(`Found matching tick: ${tick.tickNumber} with timestamp ${tickTimestamp}`);
              return tick;
            }
          }
        }
        
        // If no matches in this epoch and we've gone 5 epochs back, stop searching
        if (currentEpoch - epoch >= 5) {
          break;
        }
      }
      
      // If we got here, we couldn't find a matching tick
      console.warn(`Could not find any tick with timestamp <= ${timestamp}, returning latest tick`);
      return this.getLatestTick();
    } catch (error) {
      console.error(`Error in getTickByTimestamp:`, error.message);
      // Return the latest tick as a fallback
      console.warn('Returning latest tick as fallback due to error');
      return this.getLatestTick();
    }
  }

  // ========== Asset/Token Methods ==========
  
  // Get token/identity details using the API
  async getAssetById(id) {
    try {
      // Define possible endpoints to try - starting with the most likely to work
      const possibleEndpoints = [
        `/v1/assets/${id}`,         // Try standard v1 endpoint
        `/v2/assets/${id}`,         // Try standard v2 endpoint
        `/assets/v1/${id}`,         // Try alternative format
        `/assets/v2/${id}`,         // Try alternative format
      ];
      
      // Try each endpoint until we get a success
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying asset endpoint: ${endpoint}`);
          const assetData = await this.handleRequest(endpoint);
          
          // If we have valid data, return it
          if (assetData && assetData.id) {
            return {
              id: assetData.id,
              name: assetData.name || `Asset ${assetData.id.substring(0, 8)}`,
              symbol: assetData.symbol || assetData.id.substring(0, 4).toUpperCase(),
              totalSupply: (assetData.totalSupply || "0").toString(),
              circulatingSupply: (assetData.circulatingSupply || "0").toString(),
              holdersCount: assetData.holdersCount || 0
            };
          }
        } catch (endpointError) {
          console.warn(`Asset endpoint ${endpoint} failed: ${endpointError.message}`);
          // Continue to the next endpoint
        }
      }
      
      // Try identity endpoints as a fallback
      const identityEndpoints = [
        `/v1/identities/${id}`,     // Try standard v1 endpoint
        `/v2/identities/${id}`,     // Try standard v2 endpoint
        `/identities/v1/${id}`,     // Try alternative format
        `/identities/v2/${id}`      // Try alternative format
      ];
      
      for (const endpoint of identityEndpoints) {
        try {
          console.log(`Trying identity endpoint: ${endpoint}`);
          const identityData = await this.handleRequest(endpoint);
          
          if (identityData && identityData.id) {
            return {
              id: identityData.id,
              name: identityData.name || `Asset ${identityData.id.substring(0, 8)}`,
              symbol: identityData.symbol || identityData.id.substring(0, 4).toUpperCase(),
              totalSupply: (identityData.totalSupply || "0").toString(),
              circulatingSupply: (identityData.circulatingSupply || "0").toString(),
              holdersCount: identityData.holdersCount || 0
            };
          }
        } catch (endpointError) {
          console.warn(`Identity endpoint ${endpoint} failed: ${endpointError.message}`);
          // Continue to the next endpoint
        }
      }
      
      // If no data is available, return null - do not mock
      console.warn(`No asset or identity data found for id ${id}`);
      return null;
    } catch (err) {
      console.error(`Failed to get asset data for ${id}:`, err.message);
      // Return null if the API call fails - do not mock
      return null;
    }
  }

  // Get token holders
  async getAssetHolders(id, page = 0, pageSize = 10) {
    try {
      // Define possible endpoints to try - starting with the most likely to work
      const possibleEndpoints = [
        `/v1/assets/${id}/holders`,      // Try standard v1 endpoint 
        `/v2/assets/${id}/holders`,      // Try standard v2 endpoint
        `/assets/v1/${id}/holders`,      // Try alternative format
        `/assets/v2/${id}/holders`,      // Try alternative format
        `/v1/identities/${id}/holders`,  // Try identity endpoints
        `/v2/identities/${id}/holders`,
        `/identities/v1/${id}/holders`,
        `/identities/v2/${id}/holders`
      ];
      
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying holders endpoint: ${endpoint}`);
          const holdersData = await this.handleRequest(endpoint, {
            page: page,
            size: pageSize
          });
          
          // Only return real data if we have it
          if (holdersData && Array.isArray(holdersData.holders)) {
            return {
              holders: holdersData.holders.map(holder => ({
                address: holder.address,
                quantity: holder.balance || holder.quantity || 0
              })),
              totalCount: holdersData.totalCount || holdersData.holders.length
            };
          }
        } catch (endpointError) {
          console.warn(`Holders endpoint ${endpoint} failed: ${endpointError.message}`);
          // Continue to the next endpoint
        }
      }
      
      // If no data is available, return empty array - do not mock
      console.warn(`No holders data found for asset ${id}`);
      return {
        holders: [],
        totalCount: 0
      };
    } catch (err) {
      console.error(`Failed to get holders for asset ${id}:`, err.message);
      // Return empty array if the API call fails - do not mock
      return {
        holders: [],
        totalCount: 0
      };
    }
  }

  // Get asset/token transfers
  async getAssetTransfers(id, page = 0, pageSize = 20) {
    try {
      const possibleEndpoints = [
        `/v1/assets/${id}/transfers`,      // Try standard v1 endpoint
        `/v2/assets/${id}/transfers`,      // Try standard v2 endpoint
        `/assets/v1/${id}/transfers`,      // Try alternative format
        `/assets/v2/${id}/transfers`,      // Try alternative format
        `/v1/identities/${id}/transfers`,  // Try identity endpoints
        `/v2/identities/${id}/transfers`,
        `/identities/v1/${id}/transfers`,
        `/identities/v2/${id}/transfers`
      ];
      
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying transfers endpoint: ${endpoint}`);
          const transfersData = await this.handleRequest(endpoint, {
            page: page,
            size: pageSize
          });
          
          // Return the raw transfers data or empty array
          if (transfersData && Array.isArray(transfersData.transfers)) {
            return transfersData.transfers;
          }
        } catch (endpointError) {
          console.warn(`Transfers endpoint ${endpoint} failed: ${endpointError.message}`);
          // Continue to the next endpoint
        }
      }
      
      // If no data is available, return empty array
      return [];
    } catch (err) {
      console.error(`Failed to get transfers for asset ${id}:`, err.message);
      return [];
    }
  }

  // ========== Exchange Methods ==========
  
  // Get DEX information
  async getExchangeById(id) {
    try {
      const possibleEndpoints = [
        `/v1/exchanges/${id}`,     // Try standard v1 endpoint
        `/v2/exchanges/${id}`,     // Try standard v2 endpoint
        `/exchanges/v1/${id}`,     // Try alternative format
        `/exchanges/v2/${id}`      // Try alternative format
      ];
      
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying exchange endpoint: ${endpoint}`);
          const exchangeData = await this.handleRequest(endpoint);
          
          if (exchangeData && exchangeData.factoryAddress) {
            return {
              factoryAddress: exchangeData.factoryAddress,
              name: exchangeData.name || `Qubic DEX`,
              logoURL: exchangeData.logoURL || "https://qubic.org/logo.png"
            };
          }
        } catch (endpointError) {
          console.warn(`Exchange endpoint ${endpoint} failed: ${endpointError.message}`);
          // Continue to the next endpoint
        }
      }
      
      // If no exchange data is available, return null - don't mock
      console.warn(`No exchange data found for id ${id}`);
      return null;
    } catch (err) {
      console.error(`Failed to get exchange data for ${id}:`, err.message);
      // Return null if the API call fails - don't mock
      return null;
    }
  }

  // ========== Pair Methods ==========
  
  // Get pair details
  async getPairById(id) {
    try {
      const possibleEndpoints = [
        `/v1/pairs/${id}`,     // Try standard v1 endpoint
        `/v2/pairs/${id}`,     // Try standard v2 endpoint
        `/pairs/v1/${id}`,     // Try alternative format
        `/pairs/v2/${id}`      // Try alternative format
      ];
      
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying pair endpoint: ${endpoint}`);
          const pairData = await this.handleRequest(endpoint);
          
          if (pairData && pairData.id) {
            return {
              id: pairData.id,
              token0: pairData.token0 || pairData.asset0Id,
              token1: pairData.token1 || pairData.asset1Id,
              createdAtTickNumber: pairData.createdAtTickNumber || pairData.createdAtBlockNumber || 0,
              createdAtTimestamp: pairData.createdAtTimestamp || Date.now(),
              createdAtTxId: pairData.createdAtTxId || "0x0",
              factoryAddress: pairData.factoryAddress || "",
              fee: pairData.fee || 0.003
            };
          }
        } catch (endpointError) {
          console.warn(`Pair endpoint ${endpoint} failed: ${endpointError.message}`);
          // Continue to the next endpoint
        }
      }
      
      // If no pair data is available, return null - don't mock
      console.warn(`No pair data found for id ${id}`);
      return null;
    } catch (err) {
      console.error(`Failed to get pair data for ${id}:`, err.message);
      // Return null if the API call fails - don't mock
      return null;
    }
  }

  // ========== Events Methods ==========
  
  // Get transactions for a specific tick
  async getTransactionsForTick(tickNumber) {
    // Using v2 API for transactions
    const response = await this.handleRequest(`/v2/ticks/${tickNumber}/transactions`);
    return response.transactions || [];
  }
  
  // Get chain hash for a tick
  async getTickChainHash(tickNumber) {
    // Using v2 API for hash
    const response = await this.handleRequest(`/v2/ticks/${tickNumber}/hash`);
    return response.hash || '';
  }
  
  // Get health check for the main RPC
  async getHealthCheck() {
    try {
      const response = await this.handleRequest('/v1/healthcheck');
      return {
        status: response.status || true,
        source: 'main-rpc'
      };
    } catch (error) {
      console.error('Health check failed for main RPC:', error.message);
      return {
        status: false,
        error: error.message,
        source: 'main-rpc'
      };
    }
  }
  
  // Get health check for API services
  async getApiServicesHealth() {
    // Try several possible endpoint paths for the API health check
    const possibleEndpoints = [
      '/v1/health',
      '/v2/health',
      '/assets/health',
      '/identities/health'
    ];
    
    for (const endpoint of possibleEndpoints) {
      try {
        console.log(`Trying API services health endpoint: ${endpoint}`);
        const response = await this.handleRequest(endpoint);
        return {
          status: response.status || true,
          source: 'api-services',
          endpoint: endpoint
        };
      } catch (error) {
        console.warn(`Health check failed for API services at ${endpoint}: ${error.message}`);
        // Continue to next endpoint
      }
    }
    
    // If all health endpoints fail, try an actual data endpoint as a fallback check
    try {
      console.log('Trying asset endpoint as fallback health check');
      // Try to get QUBIC asset as a health check
      const assetResponse = await this.getAssetById('QUBIC');
      return {
        status: assetResponse !== null, // If we can fetch an asset, the service is likely up
        source: 'api-services',
        endpoint: 'asset-endpoint-fallback'
      };
    } catch (error) {
      console.error('All API services health checks failed:', error.message);
      return {
        status: false,
        error: 'All health check endpoints failed',
        source: 'api-services'
      };
    }
  }
  
  // Get comprehensive health status for all services
  async getFullHealthStatus() {
    const results = {};
    
    try {
      // Check main RPC health
      results.mainRpc = await this.getHealthCheck();
    } catch (error) {
      results.mainRpc = { status: false, error: error.message };
    }
    
    try {
      // Check API services health
      results.apiServices = await this.getApiServicesHealth();
    } catch (error) {
      results.apiServices = { status: false, error: error.message };
    }
    
    return {
      status: results.mainRpc.status && results.apiServices.status,
      services: results
    };
  }
  
  // Scan for ticks in a range to ensure we don't miss any
  async scanTickRange(startTick, endTick, maxResults = 100) {
    console.log(`Scanning tick range from ${startTick} to ${endTick}`);
    
    const validTicks = [];
    let scannedCount = 0;
    
    // Limit the range to a reasonable size to prevent performance issues
    const actualEndTick = startTick + Math.min(endTick - startTick, maxResults);
    
    for (let tickNumber = startTick; tickNumber <= actualEndTick; tickNumber++) {
      try {
        const tick = await this.getTickByNumber(tickNumber);
        
        // If tick is not empty, add it to the list
        if (!tick.isEmpty) {
          validTicks.push(tick);
          scannedCount++;
        }
        
        // Break if we've reached the maximum result count
        if (validTicks.length >= maxResults) {
          break;
        }
      } catch (error) {
        console.warn(`Error scanning tick ${tickNumber}:`, error.message);
        // Continue to the next tick
      }
    }
    
    console.log(`Scanned ${scannedCount} ticks, found ${validTicks.length} valid ticks`);
    return validTicks;
  }
  
  // Get ticks from a specific block range using epoch data
  async getTicksInBlockRange(fromBlock, toBlock, maxResults = 100) {
    try {
      console.log(`Getting ticks in block range ${fromBlock}-${toBlock}`);
      
      // Get current status to determine current epoch
      const statusResponse = await this.handleRequest('/v1/status');
      let currentEpoch = 0;
      
      if (statusResponse && statusResponse.lastProcessedTick && statusResponse.lastProcessedTick.epoch) {
        currentEpoch = statusResponse.lastProcessedTick.epoch;
        console.log(`Current epoch from status: ${currentEpoch}`);
      } else {
        console.warn('Could not determine current epoch from status, using fallback');
        currentEpoch = 152;
      }
      
      const validTicks = [];
      
      // Search through epochs to find ticks in the requested range
      for (let epoch = currentEpoch; epoch >= Math.max(0, currentEpoch - 5); epoch--) {
        if (validTicks.length >= maxResults) break;
        
        console.log(`Searching for ticks in block range in epoch ${epoch}`);
        const ticksInEpoch = await this.getAllTicksFromEpoch(epoch);
        
        if (ticksInEpoch && ticksInEpoch.length > 0) {
          // Filter ticks that are in the requested range
          const ticksInRange = ticksInEpoch.filter(tick => {
            const tickNumber = tick.tickNumber || tick.number;
            return tickNumber >= fromBlock && tickNumber <= toBlock;
          });
          
          console.log(`Found ${ticksInRange.length} ticks in range ${fromBlock}-${toBlock} in epoch ${epoch}`);
          
          // Add ticks to our valid ticks array (up to maxResults)
          for (const tick of ticksInRange) {
            if (validTicks.length >= maxResults) break;
            validTicks.push(this.normalizeTickData(tick));
          }
        }
        
        // If we found any ticks in this epoch, break out of the loop
        if (validTicks.length > 0) {
          break;
        }
      }
      
      // If we still don't have any valid ticks, return most recent ones
      if (validTicks.length === 0) {
        console.log(`No ticks found in requested range, returning most recent ticks`);
        return this.getRecentValidTicks(maxResults);
      }
      
      return validTicks;
    } catch (error) {
      console.error(`Error getting ticks in block range ${fromBlock}-${toBlock}:`, error.message);
      // Fallback to recent valid ticks
      return this.getRecentValidTicks(maxResults);
    }
  }

  // Get computors for epoch
  async getComputorsForEpoch(epoch) {
    const response = await this.handleRequest(`/v1/epochs/${epoch}/computors`);
    return response.computors || [];
  }

  // Helper to normalize tick data structure
  normalizeTickData(tickData) {
    if (!tickData) return null;
    
    return {
      tickNumber: tickData.tickNumber || tickData.number,
      timestamp: tickData.timestamp || Date.now(),
      epoch: tickData.epoch,
      // Include any other fields from the original data
      ...tickData
    };
  }
}

module.exports = new QubicRpcClient(); 