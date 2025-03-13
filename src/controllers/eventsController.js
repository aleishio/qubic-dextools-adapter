const qubicRpcClient = require('../services/qubicRpcClient');
const dataTransformer = require('../services/dataTransformer');

/**
 * Events controller handles fetching events within a specific block range
 * This is critical for DEXTools to properly index the chain
 */
class EventsController {
  /**
   * Get events in a specified block range
   * DEXTools specification requires this endpoint to:
   * - Return all events in the specified block range
   * - Support pagination for large ranges
   */
  async getEvents(req, res) {
    const { fromBlock, toBlock } = req.query;
    
    try {
      // Validate the presence of fromBlock and toBlock
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
      
      // Convert params to integers and validate
      const fromBlockInt = parseInt(fromBlock, 10);
      const toBlockInt = parseInt(toBlock, 10);
      
      if (isNaN(fromBlockInt) || isNaN(toBlockInt) || fromBlockInt < 0 || toBlockInt < 0) {
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'fromBlock/toBlock',
              code: 'invalid',
              message: 'Block numbers must be positive integer values'
            }
          ]
        });
      }
      
      // Validate that fromBlock <= toBlock
      if (fromBlockInt > toBlockInt) {
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
      
      // Set a maximum range to prevent issues with huge ranges
      const MAX_BLOCK_RANGE = 10000;
      const requestedRange = toBlockInt - fromBlockInt + 1;
      
      if (requestedRange > MAX_BLOCK_RANGE) {
        console.warn(`Requested block range ${requestedRange} exceeds maximum allowed (${MAX_BLOCK_RANGE}). Consider using pagination.`);
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'fromBlock/toBlock',
              code: 'invalid',
              message: `Block range is too large. Maximum allowed range is ${MAX_BLOCK_RANGE} blocks. Use pagination for larger ranges.`
            }
          ]
        });
      }
      
      console.log(`Requested block range: ${fromBlockInt}-${toBlockInt} (${requestedRange} blocks)`);
      console.log(`Getting ticks in range ${fromBlockInt}-${toBlockInt}...`);
      
      // Get ticks in the block range using our optimized method
      const ticks = await qubicRpcClient.getTicksInBlockRange(fromBlockInt, toBlockInt, 1000);
      console.log(`Found ${ticks.length} ticks in the requested range`);
      
      // If no ticks were found, return an empty events array - don't fall back to inefficient methods
      if (ticks.length === 0) {
        return res.json({ events: [] });
      }
      
      // Extract events from all ticks
      const allEvents = [];
      
      console.log(`Processing ${ticks.length} ticks to extract events...`);
      for (const tick of ticks) {
        try {
          // Get transactions for this tick
          const transactions = await qubicRpcClient.getTransactionsForTick(tick.tickNumber);
          console.log(`Found ${transactions.length} transactions in tick ${tick.tickNumber}`);
          
          // Extract events from transactions
          if (transactions && transactions.length > 0) {
            const eventsFromTick = await dataTransformer.transformTransactionsToEvents(
              transactions,
              tick
            );
            
            if (eventsFromTick && eventsFromTick.length > 0) {
              console.log(`Found ${eventsFromTick.length} events in tick ${tick.tickNumber}`);
              allEvents.push(...eventsFromTick);
            }
          }
        } catch (error) {
          console.error(`Error processing tick ${tick.tickNumber}:`, error.message);
          // Continue to next tick even if we encounter an error
        }
      }
      
      // Sort events by block number and then by event index
      allEvents.sort((a, b) => {
        if (a.block.blockNumber !== b.block.blockNumber) {
          return a.block.blockNumber - b.block.blockNumber;
        }
        return (a.eventIndex || 0) - (b.eventIndex || 0);
      });
      
      console.log(`Returning ${allEvents.length} events for block range ${fromBlockInt}-${toBlockInt}`);
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