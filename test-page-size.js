const QubicRpcClient = require('./src/services/qubicRpcClient').QubicRpcClient;

async function testPageSize() {
  const client = new QubicRpcClient();
  
  console.log(`DEFAULT_PAGE_SIZE: ${client.DEFAULT_PAGE_SIZE}`);
  
  // Test getting ticks from an epoch
  const epoch = 152;
  console.log(`Testing getTicksFromEpoch with epoch ${epoch}...`);
  try {
    const ticks = await client.getTicksFromEpoch(epoch, 0);
    console.log(`Retrieved ${ticks.length} ticks from epoch ${epoch}, page 0`);
  } catch (error) {
    console.error(`Error getting ticks: ${error.message}`);
  }
  
  // Test getting ticks in block range
  const fromBlock = 21180000;
  const toBlock = 21180010;
  console.log(`Testing getTicksInBlockRange with range ${fromBlock}-${toBlock}...`);
  try {
    const ticks = await client.getTicksInBlockRange(fromBlock, toBlock);
    console.log(`Retrieved ${ticks.length} ticks in block range ${fromBlock}-${toBlock}`);
  } catch (error) {
    console.error(`Error getting ticks in range: ${error.message}`);
  }
  
  console.log('Tests completed');
}

testPageSize().catch(console.error); 