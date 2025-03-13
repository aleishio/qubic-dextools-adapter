const qubicRpcClient = require('../services/qubicRpcClient');

/**
 * Health controller handles /health endpoint
 */
class HealthController {
  /**
   * Get health status of all services
   */
  async getHealth(req, res) {
    try {
      const healthStatus = await qubicRpcClient.getFullHealthStatus();
      
      // If all services are healthy
      if (healthStatus.status) {
        return res.json({
          status: 'ok',
          message: 'All services are healthy',
          details: healthStatus
        });
      }
      
      // If any service is unhealthy, return 503 Service Unavailable
      return res.status(503).json({
        status: 'error',
        message: 'One or more services are unhealthy',
        details: healthStatus
      });
    } catch (error) {
      console.error('Error checking health:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Error checking health',
        error: error.message
      });
    }
  }
  
  /**
   * Get health status of the main Qubic RPC
   */
  async getMainRpcHealth(req, res) {
    try {
      const health = await qubicRpcClient.getHealthCheck();
      
      if (health.status) {
        return res.json({
          status: 'ok',
          message: 'Qubic RPC is healthy',
          details: health
        });
      }
      
      return res.status(503).json({
        status: 'error',
        message: 'Qubic RPC is unhealthy',
        details: health
      });
    } catch (error) {
      console.error('Error checking main RPC health:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Error checking main RPC health',
        error: error.message
      });
    }
  }
  
  /**
   * Get health status of the API Services
   */
  async getTransfersApiHealth(req, res) {
    try {
      const health = await qubicRpcClient.getApiServicesHealth();
      
      if (health.status) {
        return res.json({
          status: 'ok',
          message: 'API services are healthy',
          details: health
        });
      }
      
      return res.status(503).json({
        status: 'error',
        message: 'API services are unhealthy',
        details: health
      });
    } catch (error) {
      console.error('Error checking API services health:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Error checking API services health',
        error: error.message
      });
    }
  }
}

module.exports = new HealthController(); 