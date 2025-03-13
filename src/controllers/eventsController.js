const qubicRpcClient = require('../services/qubicRpcClient');
const dataTransformer = require('../services/dataTransformer');

/**
 * Events controller for the /events endpoint
 * 
 * This is a critical endpoint for DEXTools indexing. According to the spec:
 * 1. DEXTools calls /latest-block to get the latest processed block
 * 2. It then calls /events with fromBlock and toBlock to get events for blocks it hasn't indexed
 * 3. We MUST return ALL events for the requested block range or DEXTools will miss them permanently
 */
class EventsController {
  /**
   * Get events in a block range
   */
  async getEvents(req, res) {
    try {
      const { fromBlock, toBlock } = req.query;
      
      // Validate params
      if (!fromBlock || !toBlock) {
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'fromBlock/toBlock',
              code: 'required',
              message: 'Both fromBlock and toBlock parameters are required'
            }
          ]
        });
      }
      
      const fromBlockNum = parseInt(fromBlock, 10);
      const toBlockNum = parseInt(toBlock, 10);
      
      if (isNaN(fromBlockNum) || isNaN(toBlockNum)) {
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'fromBlock/toBlock',
              code: 'invalid',
              message: 'Both parameters must be integers'
            }
          ]
        });
      }
      
      if (fromBlockNum < 0 || toBlockNum < 0) {
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'fromBlock/toBlock',
              code: 'negative',
              message: 'Block numbers cannot be negative'
            }
          ]
        });
      }
      
      if (fromBlockNum > toBlockNum) {
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'fromBlock/toBlock',
              code: 'invalid',
              message: 'fromBlock must be less than or equal to toBlock'
            }
          ]
        });
      }
      
      const blockRange = toBlockNum - fromBlockNum + 1;
      console.log(`Requested block range: ${fromBlockNum}-${toBlockNum} (${blockRange} blocks)`);
      
      // Check if the range is too large - increased limit for DEXTools compatibility
      // DEXTools typically requests ranges of a few hundred blocks at a time
      // But we should support larger ranges for initial syncing
      const MAX_BLOCK_RANGE = 100000; // Increased from 10000 to support initial sync
      
      if (blockRange > MAX_BLOCK_RANGE) {
        console.warn(`Requested range ${blockRange} exceeds max allowed range ${MAX_BLOCK_RANGE}`);
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'fromBlock/toBlock',
              code: 'range_too_large',
              message: `Range too large. Maximum block range allowed is ${MAX_BLOCK_RANGE}`
            }
          ]
        });
      }
      
      // Get ticks in the requested range
      // This will handle large ranges efficiently with pagination across epochs
      console.log(`Getting ticks in range ${fromBlockNum}-${toBlockNum}...`);
      
      // Don't limit the number of ticks - DEXTools needs ALL ticks in the range
      const ticksInRange = await qubicRpcClient.getTicksInBlockRange(fromBlockNum, toBlockNum);
      
      if (!ticksInRange || ticksInRange.length === 0) {
        console.log(`No valid ticks found in range ${fromBlockNum}-${toBlockNum}`);
        // Return empty events array if no ticks found
        return res.json({ events: [] });
      }
      
      console.log(`Found ${ticksInRange.length} valid ticks in range ${fromBlockNum}-${toBlockNum}`);
      
      // Process each tick to extract events
      const allEvents = [];
      let processedCount = 0;
      
      for (const tick of ticksInRange) {
        try {
          processedCount++;
          // Log progress for large ranges
          if (processedCount % 100 === 0) {
            console.log(`Processing tick ${tick.tickNumber} (${processedCount}/${ticksInRange.length})`);
          }
          
          // Get transactions for this tick
          const transactions = await qubicRpcClient.getTransactionsForTick(tick.tickNumber);
          
          if (transactions && transactions.length > 0) {
            console.log(`Found ${transactions.length} transactions in tick ${tick.tickNumber}`);
            
            // Transform transactions to events
            const eventsFromTick = await dataTransformer.transformTransactionsToEvents(
              transactions, 
              tick
            );
            
            if (eventsFromTick && eventsFromTick.length > 0) {
              console.log(`Extracted ${eventsFromTick.length} events from tick ${tick.tickNumber}`);
              allEvents.push(...eventsFromTick);
            }
          } else {
            console.log(`No transactions found in tick ${tick.tickNumber}`);
          }
        } catch (tickError) {
          console.error(`Error processing tick ${tick.tickNumber}:`, tickError.message);
          // Continue to next tick even if there's an error - don't skip any ticks
        }
      }
      
      console.log(`Total events found in range ${fromBlockNum}-${toBlockNum}: ${allEvents.length}`);
      
      // Sort events by block number and event index - crucial for DEXTools
      allEvents.sort((a, b) => {
        if (a.block.blockNumber !== b.block.blockNumber) {
          return a.block.blockNumber - b.block.blockNumber;
        }
        return a.eventIndex - b.eventIndex;
      });
      
      return res.json({ events: allEvents });
    } catch (error) {
      console.error('Error getting events:', error);
      return res.status(500).json({
        code: '500',
        message: 'Server was not able to return a response. Try later'
      });
    }
  }
}

module.exports = new EventsController(); 