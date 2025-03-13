require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  qubic: {
    rpcUrl: process.env.QUBIC_RPC_URL || 'https://rpc.qubic.org',
  }
}; 