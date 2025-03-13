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

### Testing the Adapter

Test the Qubic RPC connection:
```
npm run test:rpc
```

Test the complete adapter functionality:
```
npm test
```

## DEXTools HTTP API Specification

The `http-adapter` directory contains the OpenAPI specification for the DEXTools HTTP API. This specification defines the endpoints that any blockchain or DEX must implement to integrate with DEXTools.

For more details, see the [http-adapter/http-adapter-specification.yml](http-adapter/http-adapter-specification.yml) file.

## API Endpoints Implemented

The adapter implements the following endpoints as required by DEXTools:

- `GET /latest-block` - Latest block in the blockchain
- `GET /block` - Block by number or timestamp
- `GET /asset` - Token by id
- `GET /asset/holders` - Paginated list of holders of a token
- `GET /exchange` - DEX info by factory address
- `GET /pair` - Pair details by id
- `GET /events` - Events in a block range

### Additional Health Check Endpoints

The adapter also provides health check endpoints to monitor the services:

- `GET /health` - Overall health of all services
- `GET /health/rpc` - Health of the main Qubic RPC
- `GET /health/api` - Health of the Qubic API services

## Implementation Notes

### Qubic Data Structure

This adapter interfaces with Qubic's three main data sources:

1. **Archive Tree**: Historical data for processed ticks and transactions
2. **Live Tree**: Real-time data for recent ticks and transactions
3. **Qubic Transfer API**: Asset/token related data (identities, holders, etc.)

All of these services are accessed through the same RPC endpoint with different API paths.

### Qubic RPC Endpoints Used

This adapter uses the Qubic RPC service at https://rpc.qubic.org with the following endpoints:

- `/v1/latestTick` - Get the latest processed tick
- `/v1/ticks/{tickNumber}` - Get tick data by tick number
- `/v2/ticks/{tickNumber}/transactions` - Get transactions for a tick
- `/v1/status` - Get network status
- `/v2/epochs/{epoch}/ticks` - Get ticks for an epoch
- `/v1/healthcheck` - Health check for main RPC

### API Endpoints Used

The adapter uses various API endpoints for DEX-related data:

- `/v1/assets/{id}` - Get asset details
- `/v2/assets/{id}` - Alternative asset endpoint
- `/v1/assets/{id}/holders` - Get asset holders
- `/v1/identities/{id}` - Alternative endpoint for asset details
- `/v1/exchanges/{id}` - Get exchange details
- `/v1/pairs/{id}` - Get pair details

### Concept Mapping

This adapter maps Qubic concepts to DEXTools concepts:
- Qubic ticks → DEXTools blocks
- Qubic transactions → DEXTools events
- Qubic identities → DEXTools assets/tokens

### Handling Qubic Tick Quality Issues

Qubic ticks have some important characteristics that impact this adapter:

- Ticks last only 1-2 seconds and are processed rapidly
- Many ticks may be empty or fail (approximately 10% of ticks are valid)
- Ticks are organized into epochs that change weekly

The adapter implements comprehensive strategies to handle these cases:

1. **Valid Tick Detection**:
   - Only returns ticks that contain valid data and events
   - For `/latest-block`, ensures we return the most recent valid tick with events
   - For `/block`, tries to find the closest valid tick if the exact one is empty

2. **Expanded Scanning**:
   - When searching for events in a block range, scans a wider range to find valid ticks
   - Filters results to match the requested range
   - Ensures no events are missed due to empty ticks

3. **Fallback Mechanisms**:
   - If a specific tick is not found, tries nearby ticks (previous or next)
   - For the latest tick, if it's empty, tries up to 5 previous ticks
   - Implements comprehensive epoch-based scanning for timestamp queries

These measures ensure stable operation even with the fast-paced and sometimes unpredictable
nature of Qubic ticks, while strictly adhering to the DEXTools HTTP adapter specification.

### Data Availability

For endpoints where data may not be available through the Qubic API:
- If asset, exchange, or pair data isn't available, a 404 response is returned
- Empty collections (like holders with no data) will return empty arrays
- No mock data is used - the adapter only returns real data from the Qubic API

## Troubleshooting

- Verify the RPC endpoint in your .env file
- Run the RPC test (`npm run test:rpc`) to check API connectivity
- Check the adapter logs for API connection errors
- Use the test script to diagnose specific endpoint issues
