const qubicRpcClient = require('../services/qubicRpcClient');
const dataTransformer = require('../services/dataTransformer');

/**
 * Exchange controller handles /exchange endpoint
 */
class ExchangeController {
  /**
   * Get exchange details by id
   */
  async getExchange(req, res) {
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
      
      const exchange = await qubicRpcClient.getExchangeById(id);
      
      // Handle not found
      if (!exchange) {
        return res.status(404).json({
          code: '404',
          message: 'Exchange not found.'
        });
      }
      
      const transformedExchange = dataTransformer.transformExchangeToExchange(exchange);
      return res.json({ exchange: transformedExchange });
    } catch (error) {
      console.error('Error getting exchange:', error);
      return res.status(500).json({
        code: '500',
        message: 'Server was not able to return a response. Try later'
      });
    }
  }
}

module.exports = new ExchangeController(); 