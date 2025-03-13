# Qubic DEXTools Integration

This repository contains a DEXTools HTTP adapter for the Qubic blockchain. The adapter implements the DEXTools HTTP API specification, enabling Qubic's blockchain data to be indexed and displayed on DEXTools.

## Repository Structure

- `/src` - The Qubic DEXTools adapter implementation
- `/http-adapter` - Reference materials for the DEXTools HTTP API specification

## Qubic DEXTools Adapter

The adapter transforms Qubic blockchain data (ticks, transactions, identities) into the format expected by DEXTools (blocks, events, assets).

### Requirements

- Node.js (v14+ recommended)
- Access to Qubic RPC endpoint (https://rpc.qubic.org)

### Configuration

Create a `.env` file in the root directory with the following variables:

```
# Qubic RPC Endpoint
QUBIC_RPC_URL=https://rpc.qubic.org

# DEXTools Adapter Server Config
PORT=3000
NODE_ENV=development
```

### Running the Adapter

Production mode:
```
npm start
```

Development mode (with auto-restart):
```
npm run dev
```

## DEXTools HTTP API Implementation

The adapter implements the following endpoints as required by the DEXTools HTTP adapter specification:

- `GET /latest-block` - Latest block in the blockchain
- `GET /block` - Block by number or timestamp
- `GET /asset` - Token by id
- `GET /asset/holders` - Paginated list of holders of a token
- `GET /exchange` - DEX info by factory address
- `GET /pair` - Pair details by id
- `GET /events` - Events in a block range

## Implementation Notes

### Qubic Data Structure and Mapping to DEXTools

This adapter maps Qubic concepts to DEXTools concepts:

- **Qubic ticks → DEXTools blocks**: In Qubic, ticks are the fundamental unit of blockchain progression, similar to blocks in other chains
- **Qubic transactions → DEXTools events**: Transactions in Qubic ticks are transformed into DEXTools event format
- **Qubic identities → DEXTools assets/tokens**: Qubic identities are mapped to DEXTools assets

### Understanding Qubic's Tick and Epoch Structure

Qubic has a unique blockchain structure that requires special handling:

1. **Rapid Tick Processing**: 
   - Ticks in Qubic last only 1-2 seconds and are processed extremely rapidly
   - This means thousands of ticks are processed each hour, millions per epoch
   - DEXTools must be able to access all historical ticks without missing any

2. **Network Reliability Issues**:
   - Approximately 10% of individual tick endpoints (/v1/ticks/{tickNumber}) fail or return empty data
   - Direct tick-by-tick access suffers from inconsistent network reliability
   - When fetching thousands of ticks sequentially, these failures accumulate and cause significant data gaps

3. **Weekly Epoch Changes**:
   - Ticks are organized into epochs that change weekly
   - There are currently 152+ historical epochs in the Qubic blockchain
   - Each epoch can contain millions of ticks
   - When searching for ticks, the adapter must be able to find them across any epoch

4. **Critical for DEXTools Indexing**:
   - The DEXTools specification requires that all events must be available at the time a block is reported
   - If any events are missed due to tick unavailability, they'll never be indexed by DEXTools
   - This makes complete historical coverage of all ticks essential
   - DEXTools indexes "as fast as possible," so recent ticks must be prioritized for performance

### Implementation Strategies

The adapter implements comprehensive strategies to ensure complete coverage of Qubic's data:

1. **High-Performance API Access**:
   - Utilizes an optimized page size of 500 (verified to be accepted by the Qubic API)
   - Reduces API calls by 80% compared to the default page size of 100
   - Implements extended timeout (30 seconds) for large data requests 
   - Adds max content length handling (50MB) for processing large responses
   - Makes API calls more resilient to temporary network issues

2. **Smart Tick Retrieval**:
   - Implements targeted page estimation to find specific ticks without scanning full epochs
   - Uses binary search pattern to efficiently locate ticks across historical data
   - For the latest blocks, focuses on retrieving only the most recent ticks instead of full epoch scans
   - Verifies transaction data availability before returning blocks to ensure DEXTools can access all events

3. **Multi-Layer Caching**:
   - Caches individual ticks, epoch data, and transaction data independently
   - Prioritizes caching of recent tick data for faster access to latest blocks
   - Maintains epoch range information to quickly determine which epoch contains specific ticks
   - Avoids redundant API calls for frequently requested data

4. **Epoch-Based Access**:
   - Instead of fetching individual ticks, retrieves ticks in bulk from epoch endpoints
   - The `/v2/epochs/{epoch}/ticks` endpoint provides much higher reliability than individual tick endpoints
   - This approach bypasses the ~10% failure rate of individual tick endpoints
   - Ensures we don't miss any ticks due to network issues or empty responses

5. **DEXTools-Required Safety Measures**:
   - For `/latest-block`, applies a safety buffer and verifies event availability before returning
   - For block searches, implements fallbacks to find valid ticks if the specific one is empty
   - Ensures complete event coverage for any requested block range

6. **Efficient Range Processing**:
   - When DEXTools requests the `/events` endpoint for a range of blocks, only fetches relevant pages
   - Limits the number of pages checked to maintain performance for large ranges
   - Returns all events from every valid tick in the requested range
   - Sorts events by block number and event index as required by the specification

These measures ensure stable operation even with Qubic's unique high-frequency tick structure, while strictly adhering to the DEXTools HTTP adapter specification requirements for data consistency and availability.

## Troubleshooting

- Verify the RPC endpoint in your .env file
- Check the adapter logs for API connection errors
- Ensure enough memory is available for processing large tick ranges
- If you encounter 404 errors for estimated pages, this is normal behavior as the adapter tries different page numbers to find the right data
