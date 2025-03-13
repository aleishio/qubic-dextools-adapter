const app = require('./app');
const config = require('./config');

// Start server
const server = app.listen(config.port, () => {
  console.log(`DEXTools Adapter for Qubic running on port ${config.port} in ${config.nodeEnv} mode`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}); 