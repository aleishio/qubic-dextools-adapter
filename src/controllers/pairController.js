const qubicRpcClient = require('../services/qubicRpcClient');
const dataTransformer = require('../services/dataTransformer');

/**
 * Pair controller handles /pair endpoint
 */
class PairController {
  /**
   * Get pair details by id
   */
  async getPair(req, res) {
    try {
      const { id } = req.query;
      
      // Validate id param
      if (!id) {
        return res.status(400).json({
          code: '400',
          message: 'Missing parameter',
          issues: [
            {
              param: 'id',
              code: 'required',
              message: 'Id parameter is required'
            }
          ]
        });
      }
      
      const pair = await qubicRpcClient.getPairById(id);
      
      // Handle not found
      if (!pair) {
        return res.status(404).json({
          code: '404',
          message: 'Pair not found.'
        });
      }
      
      const transformedPair = dataTransformer.transformPairToPair(pair);
      return res.json({ pair: transformedPair });
    } catch (error) {
      console.error('Error getting pair:', error);
      return res.status(500).json({
        code: '500',
        message: 'Server was not able to return a response. Try later'
      });
    }
  }
}

module.exports = new PairController(); 