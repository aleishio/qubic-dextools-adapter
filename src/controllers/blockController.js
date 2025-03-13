const qubicRpcClient = require('../services/qubicRpcClient');
const dataTransformer = require('../services/dataTransformer');

/**
 * Block controller handles /latest-block and /block endpoints
 * 
 * These are critical endpoints for DEXTools:
 * - `/latest-block` is used by DEXTools to determine what blocks have been indexed
 * - It must ONLY return a block when ALL events for that block have been processed
 * - DEXTools tracks its indexing progress based on the blocks returned by this endpoint
 */
class BlockController {
  /**
   * Get latest block
   * 
   * IMPORTANT: According to DEXTools spec:
   * "It's mandatory that this endpoint returns a block only when all events of that block have been processed and are
   * available at the _events_ endpoint. If not, DEXTools might loose some events and they won't be available ever in the
   * platform."
   */
  async getLatestBlock(req, res) {
    try {
      // Get the most recent valid tick with our safety buffer applied
      // The safety buffer ensures we never return a block that's too recent
      // where events might not be processed yet (crucial for DEXTools spec)
      const latestValidTick = await qubicRpcClient.getLatestTick();
      
      if (!latestValidTick || !latestValidTick.tickNumber) {
        console.error('No valid tick found for latest block');
        return res.status(500).json({
          code: '500',
          message: 'Server was not able to return a response. Try later'
        });
      }
      
      // Check if this tick has transactions/events available
      // This is CRITICAL to meet the spec requirement that all events must be available
      try {
        const transactions = await qubicRpcClient.getTransactionsForTick(latestValidTick.tickNumber);
        
        // Even if there are no transactions, we need to make sure the API endpoint for this tick works
        // This confirms we can retrieve transaction data for this tick, ensuring all data is available
        console.log(`Verified transaction data availability for tick ${latestValidTick.tickNumber}, found ${transactions?.length || 0} transactions`);
      } catch (error) {
        // If we can't get transaction data for this tick, it's not safe to return it as the latest block
        // This ensures we strictly follow the DEXTools spec about event availability
        console.error(`Cannot get transaction data for tick ${latestValidTick.tickNumber}, finding earlier tick`);
        
        // Get a different tick that's definitely fully processed
        const saferTicks = await qubicRpcClient.getRecentValidTicks(5);
        
        // Find the first tick that has accessible transaction data
        for (const tick of saferTicks) {
          try {
            await qubicRpcClient.getTransactionsForTick(tick.tickNumber);
            console.log(`Found alternative safe tick ${tick.tickNumber} with accessible transaction data`);
            // Use this tick instead since we verified transaction data is available
            return res.json({ block: dataTransformer.transformTickToBlock(tick) });
          } catch (innerError) {
            console.warn(`Tick ${tick.tickNumber} also has inaccessible transaction data, trying next`);
            continue;
          }
        }
        
        // If we get here, we couldn't find any tick with accessible transaction data
        return res.status(500).json({
          code: '500',
          message: 'Server was not able to return a response. Try later'
        });
      }
      
      console.log(`Using tick ${latestValidTick.tickNumber} as latest block - verified data availability`);
      
      // Transform the tick to a block
      const block = dataTransformer.transformTickToBlock(latestValidTick);
      
      return res.json({ block });
    } catch (error) {
      console.error('Error getting latest block:', error);
      return res.status(500).json({
        code: '500',
        message: 'Server was not able to return a response. Try later'
      });
    }
  }

  /**
   * Get block by number or timestamp
   */
  async getBlock(req, res) {
    try {
      const { number, timestamp } = req.query;
      
      // Validate params
      if (!number && !timestamp) {
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'number/timestamp',
              code: 'required',
              message: 'Either number or timestamp parameter is required'
            }
          ]
        });
      }

      let tick;
      
      // Number takes precedence
      if (number) {
        const blockNumber = parseInt(number, 10);
        if (isNaN(blockNumber) || blockNumber < 0) {
          return res.status(400).json({
            code: '400',
            message: 'Invalid parameters',
            issues: [
              {
                param: 'number',
                code: 'invalid',
                message: 'Block number must be a positive integer value'
              }
            ]
          });
        }
        
        // Try to get the exact tick first
        tick = await qubicRpcClient.getTickByNumber(blockNumber);
        
        // If the tick is empty, try to find a nearby valid tick
        if (tick.isEmpty) {
          console.log(`Requested tick ${blockNumber} is empty, searching for nearby valid tick`);
          
          // Search for valid ticks in a small range around the requested block
          const searchRange = 5;
          const startBlock = Math.max(0, blockNumber - searchRange);
          const endBlock = blockNumber + searchRange;
          
          const nearbyTicks = await qubicRpcClient.getTicksInBlockRange(startBlock, endBlock, 10);
          
          if (nearbyTicks && nearbyTicks.length > 0) {
            // Find the closest tick to the requested block
            nearbyTicks.sort((a, b) => 
              Math.abs(a.tickNumber - blockNumber) - Math.abs(b.tickNumber - blockNumber)
            );
            
            tick = nearbyTicks[0];
            console.log(`Found nearby valid tick ${tick.tickNumber} instead of ${blockNumber}`);
          }
        }
      } else {
        const blockTimestamp = parseInt(timestamp, 10);
        if (isNaN(blockTimestamp) || blockTimestamp < 0) {
          return res.status(400).json({
            code: '400',
            message: 'Invalid parameters',
            issues: [
              {
                param: 'timestamp',
                code: 'invalid',
                message: 'Timestamp must be a positive integer value'
              }
            ]
          });
        }
        
        // Get tick by timestamp (this already handles finding valid ticks)
        tick = await qubicRpcClient.getTickByTimestamp(blockTimestamp);
      }
      
      // Handle not found or empty tick
      if (!tick || tick.isEmpty) {
        return res.status(404).json({
          code: '404',
          message: 'Block not found.'
        });
      }
      
      const block = dataTransformer.transformTickToBlock(tick);
      return res.json({ block });
    } catch (error) {
      console.error('Error getting block:', error);
      return res.status(500).json({
        code: '500',
        message: 'Server was not able to return a response. Try later'
      });
    }
  }
}

module.exports = new BlockController(); 