const qubicRpcClient = require('../services/qubicRpcClient');
const dataTransformer = require('../services/dataTransformer');

/**
 * Asset controller handles /asset and /asset/holders endpoints
 */
class AssetController {
  /**
   * Get asset details by id
   */
  async getAsset(req, res) {
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
      
      const asset = await qubicRpcClient.getAssetById(id);
      
      // Handle not found
      if (!asset) {
        return res.status(404).json({
          code: '404',
          message: 'Asset not found.'
        });
      }
      
      const transformedAsset = dataTransformer.transformAssetToAsset(asset);
      return res.json({ asset: transformedAsset });
    } catch (error) {
      console.error('Error getting asset:', error);
      return res.status(500).json({
        code: '500',
        message: 'Server was not able to return a response. Try later'
      });
    }
  }

  /**
   * Get asset holders
   */
  async getAssetHolders(req, res) {
    try {
      const { id, page = 0, pageSize = 10 } = req.query;
      
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
      
      // Validate page and pageSize
      const pageNum = parseInt(page, 10);
      const pageSizeNum = parseInt(pageSize, 10);
      
      if (isNaN(pageNum) || pageNum < 0) {
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'page',
              code: 'invalid',
              message: 'Page must be a non-negative integer'
            }
          ]
        });
      }
      
      if (isNaN(pageSizeNum) || pageSizeNum < 10 || pageSizeNum > 50) {
        return res.status(400).json({
          code: '400',
          message: 'Invalid parameters',
          issues: [
            {
              param: 'pageSize',
              code: 'invalid',
              message: 'PageSize must be an integer between 10 and 50'
            }
          ]
        });
      }
      
      // Fetch asset details to verify it exists and get total holders count
      const asset = await qubicRpcClient.getAssetById(id);
      
      // Handle not found
      if (!asset) {
        return res.status(404).json({
          code: '404',
          message: 'Asset not found.'
        });
      }
      
      // Fetch holders data
      const holdersData = await qubicRpcClient.getAssetHolders(id, pageNum, pageSizeNum);
      
      // Transform data
      const transformedHolders = dataTransformer.transformAssetHolders(
        id, 
        holdersData.holders,
        holdersData.totalCount || asset.holdersCount || 0
      );
      
      return res.json(transformedHolders);
    } catch (error) {
      console.error('Error getting asset holders:', error);
      return res.status(500).json({
        code: '500',
        message: 'Server was not able to return a response. Try later'
      });
    }
  }
}

module.exports = new AssetController(); 