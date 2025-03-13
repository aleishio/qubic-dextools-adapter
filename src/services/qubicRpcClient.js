const axios = require('axios');
const config = require('../config');

class QubicRpcClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.qubic.rpcUrl,
      timeout: 30000, // Increased timeout from 10000 to 30000 (30 seconds) for better reliability
      maxContentLength: 50 * 1024 * 1024, // Add 50MB max content length to handle large responses
    });
    console.log(`Using RPC endpoint: ${config.qubic.rpcUrl}`);
    
    // Initialize cache
    this.cache = {
      epochData: {}, // Cache for epoch data
      ticks: {},     // Cache for individual ticks
      status: null,  // Cache for last status check
      statusTimestamp: 0,
      epochRanges: {}, // Cache for epoch tick ranges
      transactions: {}, // Cache for transaction data by tick
    };
    
    // Safety buffer for latest block (how many blocks to go back from absolute latest)
    this.LATEST_BLOCK_SAFETY_BUFFER = 10;
    
    // Use 500 as default page size for performance
    this.DEFAULT_PAGE_SIZE = 500;
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
    const pageSize = 500; // INCREASED from 100 to 500 for better performance
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
        
        // Instead of fetching ALL ticks in the current epoch, just fetch the most recent ones
        // We'll use a smaller page size and limit pages to ensure fast response
        const RECENT_TICKS_MAX = 200; // Only get the most recent 200 ticks max
        const MAX_PAGES = 2; // Only check up to 2 pages
        
        let recentTicks = [];
        const pageSize = 100;
        
        // Try to get specifically the page that might contain our tick
        const estimatedPage = Math.floor(safeTickNumber / pageSize);
        console.log(`Getting recent ticks from epoch ${currentEpoch}, estimated page: ${estimatedPage}`);
        
        // Try with a direct request to the estimated page first
        try {
          const ticksResponse = await this.handleRequest(
            `/v2/epochs/${currentEpoch}/ticks`,
            { page: estimatedPage, pageSize }
          );
          
          if (ticksResponse && ticksResponse.ticks && Array.isArray(ticksResponse.ticks)) {
            for (const tick of ticksResponse.ticks) {
              // Normalize and cache individual ticks
              const tickNumber = tick.tickNumber || tick.number;
              this.cache.ticks[tickNumber] = this.normalizeTickData(tick);
              recentTicks.push(this.cache.ticks[tickNumber]);
            }
          }
        } catch (error) {
          console.warn(`Error fetching estimated page ${estimatedPage}, will try with recent pages`);
        }
        
        // If we couldn't find the tick in the estimated page, try the most recent pages
        if (!recentTicks.find(t => t.tickNumber === safeTickNumber)) {
          // Get most recent pages
          for (let page = 0; page < MAX_PAGES; page++) {
            if (recentTicks.length >= RECENT_TICKS_MAX) break;
            
            try {
              console.log(`Fetching epoch ${currentEpoch} page ${page} for recent ticks`);
              const ticksResponse = await this.handleRequest(
                `/v2/epochs/${currentEpoch}/ticks`,
                { page, pageSize }
              );
              
              if (ticksResponse && ticksResponse.ticks && Array.isArray(ticksResponse.ticks)) {
                for (const tick of ticksResponse.ticks) {
                  // Normalize and cache individual ticks
                  const tickNumber = tick.tickNumber || tick.number;
                  this.cache.ticks[tickNumber] = this.normalizeTickData(tick);
                  recentTicks.push(this.cache.ticks[tickNumber]);
                  
                  if (recentTicks.length >= RECENT_TICKS_MAX) break;
                }
              } else {
                break; // No more ticks
              }
            } catch (error) {
              console.error(`Error getting ticks for epoch ${currentEpoch} page ${page}:`, error.message);
              break;
            }
          }
        }
        
        // Sort by tick number (descending) to find most recent
        recentTicks.sort((a, b) => b.tickNumber - a.tickNumber);
        
        // Try to find the safe tick in the recent ticks
        let safeTickData = recentTicks.find(t => t.tickNumber === safeTickNumber);
        
        // If we can't find the exact tick, return the closest older one
        if (!safeTickData) {
          // Find the newest tick that's older than or equal to safeTickNumber
          const olderTicks = recentTicks.filter(t => t.tickNumber <= safeTickNumber);
          
          if (olderTicks.length > 0) {
            // Already sorted by tick number (descending), so take the first one
            safeTickData = olderTicks[0];
            console.log(`Using older tick ${safeTickData.tickNumber} as safe latest tick`);
          } else if (recentTicks.length > 0) {
            // If no older ticks, use the oldest of recent ticks
            safeTickData = recentTicks[recentTicks.length - 1];
            console.log(`No older ticks found, using oldest recent tick ${safeTickData.tickNumber}`);
          } else {
            // If no ticks at all, try previous epoch
            const prevEpoch = currentEpoch - 1;
            console.log(`No ticks found in current epoch, trying previous epoch ${prevEpoch}`);
            
            try {
              // Just get a single page from previous epoch
              const prevEpochResponse = await this.handleRequest(
                `/v2/epochs/${prevEpoch}/ticks`,
                { page: 0, pageSize }
              );
              
              if (prevEpochResponse && prevEpochResponse.ticks && Array.isArray(prevEpochResponse.ticks) && prevEpochResponse.ticks.length > 0) {
                // Use the newest tick from previous epoch
                const newestTick = prevEpochResponse.ticks.sort((a, b) => {
                  return (b.tickNumber || b.number) - (a.tickNumber || a.number);
                })[0];
                
                safeTickData = this.normalizeTickData(newestTick);
                console.log(`Using tick ${safeTickData.tickNumber} from previous epoch ${prevEpoch}`);
              }
            } catch (error) {
              console.error(`Error getting ticks from previous epoch ${prevEpoch}:`, error.message);
            }
          }
        }
        
        if (safeTickData) {
          console.log(`Found safe latest tick ${safeTickData.tickNumber}`);
          return safeTickData;
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
      
      // First try to get the tick directly by estimating the page
      const pageSize = this.DEFAULT_PAGE_SIZE;
      const estimatedPage = Math.floor(tickNumber / pageSize);
      const currentEpoch = await this.getCurrentEpoch();
      
      console.log(`Trying to find tick ${tickNumber} with estimated page ${estimatedPage}`);
      
      // Try with direct target page first in current epoch
      try {
        const ticksResponse = await this.handleRequest(
          `/v2/epochs/${currentEpoch}/ticks`,
          { page: estimatedPage, pageSize }
        );
        
        if (ticksResponse && ticksResponse.ticks && Array.isArray(ticksResponse.ticks)) {
          // Check if our tick is in this page
          const targetTick = ticksResponse.ticks.find(t => 
            (t.tickNumber || t.number) === tickNumber
          );
          
          if (targetTick) {
            console.log(`Found tick ${tickNumber} in current epoch ${currentEpoch} on estimated page ${estimatedPage}`);
            const normalizedTick = this.normalizeTickData(targetTick);
            // Cache it
            this.cache.ticks[tickNumber] = normalizedTick;
            return normalizedTick;
          }
          
          // Our tick isn't here, but maybe we can get information about the range
          if (ticksResponse.ticks.length > 0) {
            const pageTickNumbers = ticksResponse.ticks.map(t => t.tickNumber || t.number);
            const minTickInPage = Math.min(...pageTickNumbers);
            const maxTickInPage = Math.max(...pageTickNumbers);
            
            console.log(`Page ${estimatedPage} contains ticks from ${minTickInPage} to ${maxTickInPage}`);
            
            // If our target is less than the minimum, try earlier pages
            if (tickNumber < minTickInPage) {
              // Try a few pages before
              for (let pageOffset = 1; pageOffset <= 5; pageOffset++) {
                const earlierPage = Math.max(0, estimatedPage - pageOffset);
                console.log(`Trying earlier page ${earlierPage}`);
                
                try {
                  const earlierResponse = await this.handleRequest(
                    `/v2/epochs/${currentEpoch}/ticks`,
                    { page: earlierPage, pageSize }
                  );
                  
                  if (earlierResponse && earlierResponse.ticks && Array.isArray(earlierResponse.ticks)) {
                    const targetTick = earlierResponse.ticks.find(t => 
                      (t.tickNumber || t.number) === tickNumber
                    );
                    
                    if (targetTick) {
                      console.log(`Found tick ${tickNumber} on earlier page ${earlierPage}`);
                      const normalizedTick = this.normalizeTickData(targetTick);
                      // Cache it
                      this.cache.ticks[tickNumber] = normalizedTick;
                      return normalizedTick;
                    }
                  }
                } catch (pageError) {
                  console.warn(`Error checking earlier page ${earlierPage}: ${pageError.message}`);
                }
              }
            }
            
            // If our target is greater than the maximum, try later pages
            if (tickNumber > maxTickInPage) {
              // Try a few pages after
              for (let pageOffset = 1; pageOffset <= 5; pageOffset++) {
                const laterPage = estimatedPage + pageOffset;
                console.log(`Trying later page ${laterPage}`);
                
                try {
                  const laterResponse = await this.handleRequest(
                    `/v2/epochs/${currentEpoch}/ticks`,
                    { page: laterPage, pageSize }
                  );
                  
                  if (laterResponse && laterResponse.ticks && Array.isArray(laterResponse.ticks)) {
                    const targetTick = laterResponse.ticks.find(t => 
                      (t.tickNumber || t.number) === tickNumber
                    );
                    
                    if (targetTick) {
                      console.log(`Found tick ${tickNumber} on later page ${laterPage}`);
                      const normalizedTick = this.normalizeTickData(targetTick);
                      // Cache it
                      this.cache.ticks[tickNumber] = normalizedTick;
                      return normalizedTick;
                    }
                  }
                } catch (pageError) {
                  console.warn(`Error checking later page ${laterPage}: ${pageError.message}`);
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn(`Error fetching estimated page ${estimatedPage}: ${error.message}`);
      }
      
      // If we didn't find the tick with the targeted approach, check previous epochs
      // Instead of scanning ALL ticks in the epoch, use a binary search-like approach
      for (let epochOffset = 1; epochOffset <= 5; epochOffset++) {
        const prevEpoch = currentEpoch - epochOffset;
        if (prevEpoch < 0) continue;
        
        console.log(`Checking previous epoch ${prevEpoch} for tick ${tickNumber}`);
        
        // Try the same estimated page in the previous epoch
        try {
          const prevEpochResponse = await this.handleRequest(
            `/v2/epochs/${prevEpoch}/ticks`,
            { page: estimatedPage, pageSize }
          );
          
          if (prevEpochResponse && prevEpochResponse.ticks && Array.isArray(prevEpochResponse.ticks)) {
            // Check if our tick is in this page
            const targetTick = prevEpochResponse.ticks.find(t => 
              (t.tickNumber || t.number) === tickNumber
            );
            
            if (targetTick) {
              console.log(`Found tick ${tickNumber} in previous epoch ${prevEpoch}`);
              const normalizedTick = this.normalizeTickData(targetTick);
              // Cache it
              this.cache.ticks[tickNumber] = normalizedTick;
              return normalizedTick;
            }
            
            // Try binary search in this epoch if we got some ticks
            if (prevEpochResponse.ticks.length > 0) {
              const nearestTick = await this.findNearestTickWithBinarySearch(prevEpoch, tickNumber);
              if (nearestTick) {
                console.log(`Found nearest tick ${nearestTick.tickNumber} in previous epoch ${prevEpoch}`);
                // Cache this nearest match
                this.cache.ticks[tickNumber] = nearestTick;
                return nearestTick;
              }
            }
          }
        } catch (epochError) {
          console.warn(`Error checking previous epoch ${prevEpoch}: ${epochError.message}`);
        }
      }
      
      // If we couldn't find the tick in recent epochs, return a placeholder
      console.log(`Could not find tick ${tickNumber} in any epoch, returning placeholder`);
      const placeholderTick = {
        tickNumber: tickNumber,
        timestamp: Date.now()
      };
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

  // Helper method to find nearest tick using binary search approach
  async findNearestTickWithBinarySearch(epoch, targetTickNumber, maxAttempts = 8) {
    console.log(`Using binary search to find nearest tick to ${targetTickNumber} in epoch ${epoch}`);
    const pageSize = this.DEFAULT_PAGE_SIZE;
    
    // Start with page 0 to establish minimum
    let lowPage = 0;
    let highPage = 1000; // Arbitrary high number to start
    let attempts = 0;
    let bestMatch = null;
    let bestMatchDistance = Infinity;
    
    while (attempts < maxAttempts) {
      attempts++;
      const midPage = Math.floor((lowPage + highPage) / 2);
      
      try {
        console.log(`Binary search attempt ${attempts}: checking page ${midPage}`);
        const response = await this.handleRequest(
          `/v2/epochs/${epoch}/ticks`,
          { page: midPage, pageSize }
        );
        
        if (response && response.ticks && Array.isArray(response.ticks) && response.ticks.length > 0) {
          // Get tick numbers in this page
          const tickNumbers = response.ticks.map(t => t.tickNumber || t.number);
          const minTickInPage = Math.min(...tickNumbers);
          const maxTickInPage = Math.max(...tickNumbers);
          
          // Check if our target is in this page
          if (targetTickNumber >= minTickInPage && targetTickNumber <= maxTickInPage) {
            // Found the exact page, look for exact match or nearest
            const exactMatch = response.ticks.find(t => (t.tickNumber || t.number) === targetTickNumber);
            if (exactMatch) {
              return this.normalizeTickData(exactMatch);
            }
            
            // Find nearest match in this page
            let nearestInPage = response.ticks[0];
            let nearestDistance = Math.abs((nearestInPage.tickNumber || nearestInPage.number) - targetTickNumber);
            
            for (const tick of response.ticks) {
              const distance = Math.abs((tick.tickNumber || tick.number) - targetTickNumber);
              if (distance < nearestDistance) {
                nearestInPage = tick;
                nearestDistance = distance;
              }
            }
            
            return this.normalizeTickData(nearestInPage);
          }
          
          // Update our best match if we found a closer tick
          for (const tick of response.ticks) {
            const distance = Math.abs((tick.tickNumber || tick.number) - targetTickNumber);
            if (distance < bestMatchDistance) {
              bestMatch = tick;
              bestMatchDistance = distance;
            }
          }
          
          // Adjust our search range
          if (targetTickNumber < minTickInPage) {
            highPage = midPage - 1;
          } else {
            lowPage = midPage + 1;
          }
        } else {
          // No ticks in this page, try a different strategy
          highPage = midPage - 1;
        }
      } catch (error) {
        console.warn(`Error in binary search page ${midPage}: ${error.message}`);
        // If we hit an error, just skip this page
        if (midPage < (lowPage + highPage) / 2) {
          lowPage = midPage + 1;
        } else {
          highPage = midPage - 1;
        }
      }
      
      // Break if our search range is invalid
      if (lowPage > highPage) {
        break;
      }
    }
    
    // Return the best match we found, if any
    if (bestMatch) {
      return this.normalizeTickData(bestMatch);
    }
    
    return null;
  }

  // Get ticks from a specific block range - crucial for DEXTools HTTP adapter
  async getTicksInBlockRange(fromBlock, toBlock, maxResults = Infinity) {
    try {
      console.log(`Getting ticks in block range ${fromBlock}-${toBlock}, max results: ${maxResults === Infinity ? 'unlimited' : maxResults}`);
      
      // Calculate actual max results based on range size
      const rangeSize = toBlock - fromBlock + 1;
      const actualMaxResults = Math.min(maxResults, rangeSize);
      
      // Collect all valid ticks in this range
      const validTicks = [];
      const pageSize = 500; // INCREASED from 100 to 500 for better performance
      const currentEpoch = await this.getCurrentEpoch();
      
      // Use a targeted approach instead of scanning all ticks
      const fromBlockPage = Math.floor(fromBlock / pageSize);
      const toBlockPage = Math.floor(toBlock / pageSize);
      const pagesToCheck = Math.min(10, toBlockPage - fromBlockPage + 1); // Limit to 10 pages max for performance
      
      console.log(`Target pages ${fromBlockPage} to ${toBlockPage} (${pagesToCheck} pages) in current epoch ${currentEpoch}`);
      
      // First check current epoch with targeted pages
      for (let page = fromBlockPage; page <= toBlockPage && validTicks.length < actualMaxResults && page < fromBlockPage + pagesToCheck; page++) {
        try {
          console.log(`Checking page ${page} for ticks in range ${fromBlock}-${toBlock}`);
          const ticksResponse = await this.handleRequest(
            `/v2/epochs/${currentEpoch}/ticks`,
            { page, pageSize }
          );
          
          if (ticksResponse && ticksResponse.ticks && Array.isArray(ticksResponse.ticks) && ticksResponse.ticks.length > 0) {
            // Filter ticks in the requested range
            const ticksInRange = ticksResponse.ticks.filter(tick => {
              const tickNumber = tick.tickNumber || tick.number;
              return tickNumber >= fromBlock && tickNumber <= toBlock;
            });
            
            if (ticksInRange.length > 0) {
              console.log(`Found ${ticksInRange.length} ticks in range ${fromBlock}-${toBlock} on page ${page}`);
              
              // Add these ticks to our result set
              for (const tick of ticksInRange) {
                if (validTicks.length >= actualMaxResults) break;
                const normalizedTick = this.normalizeTickData(tick);
                validTicks.push(normalizedTick);
                
                // Also cache individual ticks
                this.cache.ticks[normalizedTick.tickNumber] = normalizedTick;
              }
            }
          }
        } catch (error) {
          console.warn(`Error fetching page ${page} in current epoch: ${error.message}`);
        }
      }
      
      // If we didn't find enough ticks in the current epoch, try previous epochs
      if (validTicks.length < actualMaxResults) {
        // Try a few previous epochs
        for (let epochOffset = 1; epochOffset <= 5 && validTicks.length < actualMaxResults; epochOffset++) {
          const prevEpoch = currentEpoch - epochOffset;
          if (prevEpoch < 0) continue;
          
          console.log(`Checking previous epoch ${prevEpoch} for ticks in range ${fromBlock}-${toBlock}`);
          
          // Try the same page range in previous epoch
          for (let page = fromBlockPage; page <= toBlockPage && validTicks.length < actualMaxResults && page < fromBlockPage + pagesToCheck; page++) {
            try {
              const ticksResponse = await this.handleRequest(
                `/v2/epochs/${prevEpoch}/ticks`,
                { page, pageSize }
              );
              
              if (ticksResponse && ticksResponse.ticks && Array.isArray(ticksResponse.ticks) && ticksResponse.ticks.length > 0) {
                // Filter ticks in the requested range
                const ticksInRange = ticksResponse.ticks.filter(tick => {
                  const tickNumber = tick.tickNumber || tick.number;
                  return tickNumber >= fromBlock && tickNumber <= toBlock;
                });
                
                if (ticksInRange.length > 0) {
                  console.log(`Found ${ticksInRange.length} ticks in range ${fromBlock}-${toBlock} in epoch ${prevEpoch} page ${page}`);
                  
                  // Add these ticks to our result set
                  for (const tick of ticksInRange) {
                    if (validTicks.length >= actualMaxResults) break;
                    const normalizedTick = this.normalizeTickData(tick);
                    validTicks.push(normalizedTick);
                    
                    // Also cache individual ticks
                    this.cache.ticks[normalizedTick.tickNumber] = normalizedTick;
                  }
                }
              }
            } catch (error) {
              console.warn(`Error fetching page ${page} in epoch ${prevEpoch}: ${error.message}`);
            }
          }
        }
      }
      
      // If we still don't have any valid ticks and the range is small, 
      // try to find at least one tick in the range by targeting the middle
      if (validTicks.length === 0 && rangeSize <= 1000) {
        const middleBlock = Math.floor((fromBlock + toBlock) / 2);
        console.log(`No ticks found yet, trying to find middle block ${middleBlock}`);
        
        try {
          const middleTick = await this.getTickByNumber(middleBlock);
          if (middleTick && !middleTick.error) {
            console.log(`Found middle tick ${middleTick.tickNumber}`);
            validTicks.push(middleTick);
          }
        } catch (error) {
          console.warn(`Error finding middle block: ${error.message}`);
        }
      }
      
      // If we still don't have any valid ticks, return an empty array
      // This is better than returning random recent ticks that aren't in the requested range
      if (validTicks.length === 0) {
        console.log(`No ticks found in requested range ${fromBlock}-${toBlock}`);
        return [];
      }
      
      // Sort by tick number
      validTicks.sort((a, b) => a.tickNumber - b.tickNumber);
      
      console.log(`Returning ${validTicks.length} ticks for range ${fromBlock}-${toBlock}`);
      return validTicks;
    } catch (error) {
      console.error(`Error getting ticks in block range ${fromBlock}-${toBlock}:`, error.message);
      return [];
    }
  }

  // Get the most recent valid ticks directly from epoch data
  async getRecentValidTicks(count = 10) {
    try {
      // Get current epoch
      const currentEpoch = await this.getCurrentEpoch();
      
      const validTicks = [];
      const pageSize = 500; // INCREASED from 100 to 500 for better performance
      
      // Just get the first page of ticks for the most recent ones
      console.log(`Getting recent ticks from epoch ${currentEpoch}`);
      
      try {
        const ticksResponse = await this.handleRequest(
          `/v2/epochs/${currentEpoch}/ticks`,
          { page: 0, pageSize }
        );
        
        if (ticksResponse && ticksResponse.ticks && Array.isArray(ticksResponse.ticks) && ticksResponse.ticks.length > 0) {
          console.log(`Found ${ticksResponse.ticks.length} ticks in epoch ${currentEpoch}`);
          
          // Sort by tick number (descending) to get most recent first
          const sortedTicks = ticksResponse.ticks.sort((a, b) => {
            return (b.tickNumber || b.number) - (a.tickNumber || a.number);
          });
          
          // Take the first 'count' ticks
          for (let i = 0; i < Math.min(count, sortedTicks.length); i++) {
            const normalizedTick = this.normalizeTickData(sortedTicks[i]);
            validTicks.push(normalizedTick);
            
            // Also cache individual ticks
            this.cache.ticks[normalizedTick.tickNumber] = normalizedTick;
          }
        }
      } catch (error) {
        console.warn(`Error getting ticks for epoch ${currentEpoch}: ${error.message}`);
        
        // Try previous epoch if current fails
        if (currentEpoch > 0) {
          const prevEpoch = currentEpoch - 1;
          console.log(`Trying previous epoch ${prevEpoch}`);
          
          try {
            const prevTicksResponse = await this.handleRequest(
              `/v2/epochs/${prevEpoch}/ticks`,
              { page: 0, pageSize }
            );
            
            if (prevTicksResponse && prevTicksResponse.ticks && Array.isArray(prevTicksResponse.ticks)) {
              const sortedTicks = prevTicksResponse.ticks.sort((a, b) => {
                return (b.tickNumber || b.number) - (a.tickNumber || a.number);
              });
              
              for (let i = 0; i < Math.min(count - validTicks.length, sortedTicks.length); i++) {
                const normalizedTick = this.normalizeTickData(sortedTicks[i]);
                validTicks.push(normalizedTick);
                this.cache.ticks[normalizedTick.tickNumber] = normalizedTick;
              }
            }
          } catch (prevError) {
            console.warn(`Error getting ticks for previous epoch ${prevEpoch}: ${prevError.message}`);
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
    try {
      // Check cache first
      if (this.cache.transactions[tickNumber]) {
        console.log(`Using cached ${this.cache.transactions[tickNumber].length} transactions for tick ${tickNumber}`);
        return this.cache.transactions[tickNumber];
      }
      
      // Using v2 API for transactions
      const response = await this.handleRequest(`/v2/ticks/${tickNumber}/transactions`);
      const transactions = response.transactions || [];
      
      // Cache transactions
      this.cache.transactions[tickNumber] = transactions;
      
      return transactions;
    } catch (error) {
      console.error(`Error getting transactions for tick ${tickNumber}:`, error.message);
      return [];
    }
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