/**
 * Test direct connection to Qubic RPC
 * Run with: node test-rpc.js
 */

const axios = require('axios');
require('dotenv').config();

const RPC_URL = process.env.QUBIC_RPC_URL || 'https://rpc.qubic.org';

const testEndpoints = async () => {
  console.log('Testing Qubic RPC connections...');
  console.log(`Base URL: ${RPC_URL}`);
  
  // First endpoint to test - Status - to get the current epoch
  console.log('\n=== Testing Status (/v1/status) ===');
  let currentEpoch;
  
  try {
    const statusResponse = await axios.get(`${RPC_URL}/v1/status`);
    console.log('SUCCESS! Response sample:', JSON.stringify(statusResponse.data).substring(0, 200) + '...');
    
    // Extract current epoch from status response
    if (statusResponse.data && statusResponse.data.lastProcessedTick && statusResponse.data.lastProcessedTick.epoch) {
      currentEpoch = statusResponse.data.lastProcessedTick.epoch;
      console.log(`\nDetected current epoch: ${currentEpoch}`);
    } else {
      throw new Error('Failed to extract current epoch from status response');
    }
  } catch (error) {
    console.error('FAILED to get status or current epoch:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    console.error('\nCannot proceed with testing epoch-dependent endpoints. Exiting.');
    return;
  }
  
  // Now test other endpoints
  const endpointsToTest = [
    { version: 'v1', path: '/latestTick', description: 'Latest Tick' },
    { version: 'v1', path: '/healthcheck', description: 'Health Check' },
    // Use dynamically obtained current epoch for testing
    { 
      version: 'v2', 
      path: `/epochs/${currentEpoch}/ticks`, 
      description: `Ticks for Current Epoch (${currentEpoch})`, 
      params: { page: 0, pageSize: 10 } 
    }
  ];
  
  for (const endpoint of endpointsToTest) {
    const fullPath = `/${endpoint.version}${endpoint.path}`;
    console.log(`\n=== Testing ${endpoint.description} (${fullPath}) ===`);
    
    try {
      const response = await axios.get(`${RPC_URL}${fullPath}`, { 
        params: endpoint.params || {} 
      });
      console.log('SUCCESS! Response sample:', JSON.stringify(response.data).substring(0, 200) + '...');
    } catch (error) {
      console.error('FAILED!', error.message);
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', error.response.data);
      }
    }
  }
  
  console.log('\n=== RPC Testing Complete ===');
};

testEndpoints().catch(error => {
  console.error('Test failed:', error.message);
}); 