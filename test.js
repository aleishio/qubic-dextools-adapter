/**
 * Test script for the Qubic DEXTools adapter
 * Tests all available endpoints to ensure they work as expected
 */
const axios = require('axios');
require('dotenv').config();

// Get port from environment or use default
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Helper to format response logs
const formatResponse = (response) => {
  if (typeof response === 'object') {
    return JSON.stringify(response, null, 2);
  }
  return response;
};

// Check if the adapter is running
async function isAdapterRunning() {
  try {
    await axios.get(`${BASE_URL}/latest-block`);
    return true;
  } catch (error) {
    return false;
  }
}

async function testAllEndpoints() {
  console.log(`Testing Qubic DEXTools adapter endpoints at ${BASE_URL}...\n`);

  // Test /latest-block endpoint
  console.log('1. Testing /latest-block endpoint...');
  try {
    const latestBlockResponse = await axios.get(`${BASE_URL}/latest-block`);
    console.log(`SUCCESS! Response: ${formatResponse(latestBlockResponse.data)}`);
    
    if (!latestBlockResponse.data.block || !latestBlockResponse.data.block.blockNumber) {
      console.log('Latest block response does not contain a valid block number');
    } else {
      const blockNumber = latestBlockResponse.data.block.blockNumber;
      console.log(`\n2. Testing /block endpoint with number=${blockNumber}...`);
      
      // Test /block endpoint with block number
      try {
        const blockResponse = await axios.get(`${BASE_URL}/block?number=${blockNumber}`);
        console.log(`SUCCESS! Response: ${formatResponse(blockResponse.data)}`);
        
        // Also test with timestamp
        const timestamp = blockResponse.data.block.blockTimestamp;
        console.log(`\n2.1 Testing /block endpoint with timestamp=${timestamp}...`);
        try {
          const timestampResponse = await axios.get(`${BASE_URL}/block?timestamp=${timestamp}`);
          console.log(`SUCCESS! Response: ${formatResponse(timestampResponse.data)}`);
        } catch (error) {
          console.log(`FAILED! Error: ${error.message}`);
          if (error.response) {
            console.log(`Response: ${formatResponse(error.response.data)}`);
          }
        }
        
        // Test events endpoint
        const fromBlock = Math.max(0, blockNumber - 2);
        const toBlock = blockNumber;
        console.log(`\n3. Testing /events endpoint with fromBlock=${fromBlock} and toBlock=${toBlock}...`);
        
        try {
          const eventsResponse = await axios.get(`${BASE_URL}/events?fromBlock=${fromBlock}&toBlock=${toBlock}`);
          const eventsCount = eventsResponse.data.events ? eventsResponse.data.events.length : 0;
          console.log(`SUCCESS! Events count: ${eventsCount}`);
          
          if (eventsCount === 0) {
            console.log('\nNo events found in the specified range. Testing with mock data...');
          } else {
            console.log(`First event: ${formatResponse(eventsResponse.data.events[0])}`);
          }
        } catch (error) {
          console.log(`FAILED! Error: ${error.message}`);
          if (error.response) {
            console.log(`Response: ${formatResponse(error.response.data)}`);
          }
        }
        
      } catch (error) {
        console.log(`FAILED! Error: ${error.message}`);
        if (error.response) {
          console.log(`Response: ${formatResponse(error.response.data)}`);
        }
      }
    }
  } catch (error) {
    console.log(`FAILED! Error: ${error.message}`);
    if (error.response) {
      console.log(`Response: ${formatResponse(error.response.data)}`);
    }
  }
  
  // Test pair endpoint with mock id
  console.log('\n4. Testing /pair endpoint with mock id...');
  try {
    const pairResponse = await axios.get(`${BASE_URL}/pair?id=mock-token1:mock-token2`);
    console.log(`SUCCESS! Response: ${formatResponse(pairResponse.data)}`);
  } catch (error) {
    console.log(`FAILED! Error: ${error.message}`);
    if (error.response) {
      console.log(`Response: ${formatResponse(error.response.data)}`);
    }
  }
  
  // Test asset endpoint with mock id
  console.log('\n5. Testing /asset endpoint with mock id...');
  try {
    const assetResponse = await axios.get(`${BASE_URL}/asset?id=mock-asset-id`);
    console.log(`SUCCESS! Response: ${formatResponse(assetResponse.data)}`);
    
    // Test asset holders endpoint with the same mock id
    console.log('\n5.1 Testing /asset/holders endpoint with mock id...');
    try {
      const holdersResponse = await axios.get(`${BASE_URL}/asset/holders?id=mock-asset-id`);
      console.log(`SUCCESS! Holders count: ${holdersResponse.data.holders ? holdersResponse.data.holders.length : 0}`);
    } catch (error) {
      console.log(`FAILED! Error: ${error.message}`);
      if (error.response) {
        console.log(`Response: ${formatResponse(error.response.data)}`);
      }
    }
  } catch (error) {
    console.log(`FAILED! Error: ${error.message}`);
    if (error.response) {
      console.log(`Response: ${formatResponse(error.response.data)}`);
    }
  }
  
  // Test exchange endpoint with mock id
  console.log('\n6. Testing /exchange endpoint with mock id...');
  try {
    const exchangeResponse = await axios.get(`${BASE_URL}/exchange?id=mock-factory-id`);
    console.log(`SUCCESS! Response: ${formatResponse(exchangeResponse.data)}`);
  } catch (error) {
    console.log(`FAILED! Error: ${error.message}`);
    if (error.response) {
      console.log(`Response: ${formatResponse(error.response.data)}`);
    }
  }
  
  console.log('\n=== DEXTools Adapter Testing Complete ===');
}

// Main
(async () => {
  if (await isAdapterRunning()) {
    await testAllEndpoints();
  } else {
    console.error('\nERROR: DEXTools adapter is not running!\n');
    console.log('Please start the adapter first with:');
    console.log('  npm start\n');
    console.log('In a separate terminal, then run this test again.');
  }
})(); 