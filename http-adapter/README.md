# DEX/Blockchain integration API

> Version 0.0.1

HTTP API specification that any blockchain or DEX must provide (via API server) in order to get integrated in DEXTools.
DEXTools will consume this API to index all trading data. Please contact with DEXTools support for more info.

For a Blockchain-level integration, multiple DEX data can be provided with one URL (e.g. dextools-api.mychain.com) 
and the `/exchange` endpoint must be implemented.

Otherwise, for a DEX-level integration, each DEX must provide a separated URL (e.g. dextools-api.one-dex.com, dextools-api.second-dex.com)

DEXTools will consume the API requesting each block as fast as possible and querying additional data to provided endpoints.

## Path Table

| Method | Path | Description |
| --- | --- | --- |
| GET | [/latest-block](#getlatest-block) | Latest block |
| GET | [/block](#getblock) | Block by number or timestamp |
| GET | [/asset](#getasset) | Token by id |
| GET | [/asset/holders](#getassetholders) | Paginated list of holders of a token by its id |
| GET | [/exchange](#getexchange) | DEX info by factory address or id |
| GET | [/pair](#getpair) | Pair by id |
| GET | [/events](#getevents) | Events |

## Reference Table

| Name | Path | Description |
| --- | --- | --- |
| Block | [#/components/schemas/Block](#componentsschemasblock) | Block schema |
| Asset | [#/components/schemas/Asset](#componentsschemasasset) | Token schema |
| AssetHolders | [#/components/schemas/AssetHolders](#componentsschemasassetholders) | List of token holders schema |
| AssetHolder | [#/components/schemas/AssetHolder](#componentsschemasassetholder) | Holder of tokens schema |
| Pair | [#/components/schemas/Pair](#componentsschemaspair) | Pair schema |
| Event | [#/components/schemas/Event](#componentsschemasevent) | Event schema |
| Exchange | [#/components/schemas/Exchange](#componentsschemasexchange) | Exchange schema |
| ResponseOfBlock | [#/components/schemas/ResponseOfBlock](#componentsschemasresponseofblock) | Response of the endpoints that return a single block |
| ResponseOfAsset | [#/components/schemas/ResponseOfAsset](#componentsschemasresponseofasset) | Response of the endpoints that return a single token |
| ResponseOfAssetHolders | [#/components/schemas/ResponseOfAssetHolders](#componentsschemasresponseofassetholders) | Response of the endpoint that return a list of holders of a token |
| ResponseOfExchange | [#/components/schemas/ResponseOfExchange](#componentsschemasresponseofexchange) | Response of the endpoints that return a single exchange |
| ResponseOfPair | [#/components/schemas/ResponseOfPair](#componentsschemasresponseofpair) | Response of the endpoints that return a single pair |
| ResponseOfEvents | [#/components/schemas/ResponseOfEvents](#componentsschemasresponseofevents) | Response of the /events endpoint |
| Issue | [#/components/schemas/Issue](#componentsschemasissue) | Schema of error details |
| ResponseOfError | [#/components/schemas/ResponseOfError](#componentsschemasresponseoferror) | Schema of all error responses |
| ErrorNotFound | [#/components/responses/ErrorNotFound](#componentsresponseserrornotfound) | Not Found |
| ErrorTooManyRequests | [#/components/responses/ErrorTooManyRequests](#componentsresponseserrortoomanyrequests) | Too Many requests |
| ErrorInternal | [#/components/responses/ErrorInternal](#componentsresponseserrorinternal) | Internal error |

## Path Details

***

### [GET]/latest-block

- Summary  
Latest block

- Description  
Returns the latest block processed in the blockchain/DEX.  
  
This endpoint is used to limit the range of events requested during the process of blocks in real time.  
  
It's mandatory that this endpoint returns a block only when all events of that block have been processed and are  
available at the _events_ endpoint. If not, DEXTools might loose some events and they won't be available ever in the  
platform.

#### Responses

- 200 OK

`application/json`

```ts
// Response of the endpoints that return a single block
{
  // Block schema
  block: {
    // Number of the block
    blockNumber: integer
    // Timestamp (in seconds) the block was confirmed at
    blockTimestamp: integer
  }
}
```

- 429 Too may requests

- 500 Internal server error

***

### [GET]/block

- Summary  
Block by number or timestamp

- Description  
Returns a specific block using either the number of the block or its timestamp.  
  
For timestamp searching, this endpoint should return the youngest block with the timestamp less than or equal  
to the requested one.  
  
If none of the parameters are requested, this endpoint must return a 400 error.  
  
If both parameters are requested, number option takes precedence.  
  
**NOTE**: The timestamp option is required only for blockchains with sharding or any other kind of partition,  
where different partitions handle different block numbers.

#### Parameters(Query)

```ts
number?: integer
```

```ts
timestamp?: integer
```

#### Responses

- 200 OK

`application/json`

```ts
// Response of the endpoints that return a single block
{
  // Block schema
  block: {
    // Number of the block
    blockNumber: integer
    // Timestamp (in seconds) the block was confirmed at
    blockTimestamp: integer
  }
}
```

- 400 Bad request

`application/json`

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

- 404 Not found

- 429 Too may requests

- 500 Internal server error

***

### [GET]/asset

- Summary  
Token by id

- Description  
Returns details of a given token by its address

#### Parameters(Query)

```ts
id: string
```

#### Responses

- 200 OK

`application/json`

```ts
// Response of the endpoints that return a single token
{
  // Token schema
  asset: {
    // Address of the token
    id?: string
    // Name of the token
    name?: string
    // Symbol of the token
    symbol?: string
    // Total supply of the token at current time
    totalSupply?: string
    // Circulating supply of the token at current time
    circulatingSupply?: string
    // Total number of holders of the token
    holdersCount?: integer
  }
}
```

- 400 Bad request

`application/json`

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

- 404 Not found

- 429 Too may requests

- 500 Internal server error

***

### [GET]/asset/holders

- Summary  
Paginated list of holders of a token by its id

- Description  
Returns a list of holders of a given token.  
  
This list must be sorted in descending order of importance, starting with the holders owning the largest number of tokens and ending with those owning the smallest number of tokens.  
  
If the requested page exceeds the number of holders of the token, this endpoint must return an empty list of holders.

#### Parameters(Query)

```ts
id: string
```

```ts
page?: integer
```

```ts
pageSize?: integer //default: 10
```

#### Responses

- 200 OK

`application/json`

```ts
// Response of the endpoint that return a list of holders of a token
{
  // List of token holders schema
  asset: {
    // Address of the token
    id: string
    // Total number of holders owning the requested token
    totalHoldersCount: integer
    // Holder of tokens schema
    holders: {
      // Address of the holder
      address: string
      // Number of tokens held by this address
      quantity: integer
    }[]
  }
}
```

- 400 Bad request

`application/json`

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

- 404 Not found

- 429 Too may requests

- 500 Internal server error

***

### [GET]/exchange

- Summary  
DEX info by factory address or id

- Description  
Return details of a given DEX by its factory address or alternative id

#### Parameters(Query)

```ts
id: string
```

#### Responses

- 200 OK

`application/json`

```ts
// Response of the endpoints that return a single exchange
{
  // Exchange schema
  exchange: {
    // Address of the factory contract
    factoryAddress: string
    // Name of the exchange
    name: string
    // URL of exchange Logo
    logoURL?: string
  }
}
```

- 400 Bad request

`application/json`

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

- 404 Not found

- 429 Too may requests

- 500 Internal server error

***

### [GET]/pair

- Summary  
Pair by id

- Description  
Returns pair details (aka pool) by its address

#### Parameters(Query)

```ts
id?: string
```

#### Responses

- 200 OK

`application/json`

```ts
// Response of the endpoints that return a single pair
{
  // Pair schema
  pair: {
    // Address of the pair
    id: string
    // Address of the first token of the pair
    asset0Id: string
    // Address of the second token of the pair
    asset1Id: string
    // Number of block the pair was created at
    createdAtBlockNumber: integer
    // Timestamp (in seconds) of the block the pair was created at
    createdAtBlockTimestamp: integer
    // Hash of the transaction the pair was created at
    createdAtTxnId: string
    // Address of the smart contract used to create the pair
    factoryAddress: string
  }
}
```

- 400 Bad request

`application/json`

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

- 404 Not found

- 429 Too may requests

- 500 Internal server error

***

### [GET]/events

- Summary  
Events

- Description  
List of events occured in a range of blocks

#### Parameters(Query)

```ts
fromBlock: integer
```

```ts
toBlock: integer
```

#### Responses

- 200 OK

`application/json`

```ts
// Response of the /events endpoint
{
  // Event schema
  events: {
    // Block schema
    block: {
      // Number of the block
      blockNumber: integer
      // Timestamp (in seconds) the block was confirmed at
      blockTimestamp: integer
    }
    // Hash of the transaction the event belongs to
    txnId: string
    // Index of the transaction the event belongs to
    txnIndex: integer
    // Index of the event inside the block. This will be used to sort events and must be unique for all events inside a block.
    eventIndex: integer
    // Address of the wallet who request the transaction
    maker: string
    // Address of the pair involved in the transaction
    pairId: string
    // Type of event (creation -> Pair created; swap -> Swap; join -> Add liquidity; exit -> Remove liquidity)
    eventType: enum[creation, swap, join, exit]
    // Only for joins and exits: Number of tokens of asset0 added to the pool
    amount0?: string
    // Only for joins and exits: Number of tokens of asset1 added to the pool
    amount1?: string
    // Only for swaps: Number of tokens of asset0 sold
    asset0In?: string
    // Only for swaps: Number of tokens of asset1 bought
    asset1Out?: string
    // Only for swaps: Number of tokens of asset0 bought
    asset0Out?: string
    // Only for swaps: Number of tokens of asset1 sold
    asset1In?: string
    // Only for joins, exists and swaps: Reserves of each token remaining after the event has been executed
    reserves: {
      // Reserves of token asset0
      asset0: string
      // Reserves of token asset1
      asset1: string
    }
  }[]
}
```

- 400 Bad request

`application/json`

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

- 404 Not found

- 429 Too may requests

- 500 Internal server error

## References

### #/components/schemas/Block

```ts
// Block schema
{
  // Number of the block
  blockNumber: integer
  // Timestamp (in seconds) the block was confirmed at
  blockTimestamp: integer
}
```

### #/components/schemas/Asset

```ts
// Token schema
{
  // Address of the token
  id?: string
  // Name of the token
  name?: string
  // Symbol of the token
  symbol?: string
  // Total supply of the token at current time
  totalSupply?: string
  // Circulating supply of the token at current time
  circulatingSupply?: string
  // Total number of holders of the token
  holdersCount?: integer
}
```

### #/components/schemas/AssetHolders

```ts
// List of token holders schema
{
  // Address of the token
  id: string
  // Total number of holders owning the requested token
  totalHoldersCount: integer
  // Holder of tokens schema
  holders: {
    // Address of the holder
    address: string
    // Number of tokens held by this address
    quantity: integer
  }[]
}
```

### #/components/schemas/AssetHolder

```ts
// Holder of tokens schema
{
  // Address of the holder
  address: string
  // Number of tokens held by this address
  quantity: integer
}
```

### #/components/schemas/Pair

```ts
// Pair schema
{
  // Address of the pair
  id: string
  // Address of the first token of the pair
  asset0Id: string
  // Address of the second token of the pair
  asset1Id: string
  // Number of block the pair was created at
  createdAtBlockNumber: integer
  // Timestamp (in seconds) of the block the pair was created at
  createdAtBlockTimestamp: integer
  // Hash of the transaction the pair was created at
  createdAtTxnId: string
  // Address of the smart contract used to create the pair
  factoryAddress: string
}
```

### #/components/schemas/Event

```ts
// Event schema
{
  // Block schema
  block: {
    // Number of the block
    blockNumber: integer
    // Timestamp (in seconds) the block was confirmed at
    blockTimestamp: integer
  }
  // Hash of the transaction the event belongs to
  txnId: string
  // Index of the transaction the event belongs to
  txnIndex: integer
  // Index of the event inside the block. This will be used to sort events and must be unique for all events inside a block.
  eventIndex: integer
  // Address of the wallet who request the transaction
  maker: string
  // Address of the pair involved in the transaction
  pairId: string
  // Type of event (creation -> Pair created; swap -> Swap; join -> Add liquidity; exit -> Remove liquidity)
  eventType: enum[creation, swap, join, exit]
  // Only for joins and exits: Number of tokens of asset0 added to the pool
  amount0?: string
  // Only for joins and exits: Number of tokens of asset1 added to the pool
  amount1?: string
  // Only for swaps: Number of tokens of asset0 sold
  asset0In?: string
  // Only for swaps: Number of tokens of asset1 bought
  asset1Out?: string
  // Only for swaps: Number of tokens of asset0 bought
  asset0Out?: string
  // Only for swaps: Number of tokens of asset1 sold
  asset1In?: string
  // Only for joins, exists and swaps: Reserves of each token remaining after the event has been executed
  reserves: {
    // Reserves of token asset0
    asset0: string
    // Reserves of token asset1
    asset1: string
  }
}
```

### #/components/schemas/Exchange

```ts
// Exchange schema
{
  // Address of the factory contract
  factoryAddress: string
  // Name of the exchange
  name: string
  // URL of exchange Logo
  logoURL?: string
}
```

### #/components/schemas/ResponseOfBlock

```ts
// Response of the endpoints that return a single block
{
  // Block schema
  block: {
    // Number of the block
    blockNumber: integer
    // Timestamp (in seconds) the block was confirmed at
    blockTimestamp: integer
  }
}
```

### #/components/schemas/ResponseOfAsset

```ts
// Response of the endpoints that return a single token
{
  // Token schema
  asset: {
    // Address of the token
    id?: string
    // Name of the token
    name?: string
    // Symbol of the token
    symbol?: string
    // Total supply of the token at current time
    totalSupply?: string
    // Circulating supply of the token at current time
    circulatingSupply?: string
    // Total number of holders of the token
    holdersCount?: integer
  }
}
```

### #/components/schemas/ResponseOfAssetHolders

```ts
// Response of the endpoint that return a list of holders of a token
{
  // List of token holders schema
  asset: {
    // Address of the token
    id: string
    // Total number of holders owning the requested token
    totalHoldersCount: integer
    // Holder of tokens schema
    holders: {
      // Address of the holder
      address: string
      // Number of tokens held by this address
      quantity: integer
    }[]
  }
}
```

### #/components/schemas/ResponseOfExchange

```ts
// Response of the endpoints that return a single exchange
{
  // Exchange schema
  exchange: {
    // Address of the factory contract
    factoryAddress: string
    // Name of the exchange
    name: string
    // URL of exchange Logo
    logoURL?: string
  }
}
```

### #/components/schemas/ResponseOfPair

```ts
// Response of the endpoints that return a single pair
{
  // Pair schema
  pair: {
    // Address of the pair
    id: string
    // Address of the first token of the pair
    asset0Id: string
    // Address of the second token of the pair
    asset1Id: string
    // Number of block the pair was created at
    createdAtBlockNumber: integer
    // Timestamp (in seconds) of the block the pair was created at
    createdAtBlockTimestamp: integer
    // Hash of the transaction the pair was created at
    createdAtTxnId: string
    // Address of the smart contract used to create the pair
    factoryAddress: string
  }
}
```

### #/components/schemas/ResponseOfEvents

```ts
// Response of the /events endpoint
{
  // Event schema
  events: {
    // Block schema
    block: {
      // Number of the block
      blockNumber: integer
      // Timestamp (in seconds) the block was confirmed at
      blockTimestamp: integer
    }
    // Hash of the transaction the event belongs to
    txnId: string
    // Index of the transaction the event belongs to
    txnIndex: integer
    // Index of the event inside the block. This will be used to sort events and must be unique for all events inside a block.
    eventIndex: integer
    // Address of the wallet who request the transaction
    maker: string
    // Address of the pair involved in the transaction
    pairId: string
    // Type of event (creation -> Pair created; swap -> Swap; join -> Add liquidity; exit -> Remove liquidity)
    eventType: enum[creation, swap, join, exit]
    // Only for joins and exits: Number of tokens of asset0 added to the pool
    amount0?: string
    // Only for joins and exits: Number of tokens of asset1 added to the pool
    amount1?: string
    // Only for swaps: Number of tokens of asset0 sold
    asset0In?: string
    // Only for swaps: Number of tokens of asset1 bought
    asset1Out?: string
    // Only for swaps: Number of tokens of asset0 bought
    asset0Out?: string
    // Only for swaps: Number of tokens of asset1 sold
    asset1In?: string
    // Only for joins, exists and swaps: Reserves of each token remaining after the event has been executed
    reserves: {
      // Reserves of token asset0
      asset0: string
      // Reserves of token asset1
      asset1: string
    }
  }[]
}
```

### #/components/schemas/Issue

```ts
// Schema of error details
{
  code?: string
  param?: string
  message: string
}
```

### #/components/schemas/ResponseOfError

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

### #/components/responses/ErrorNotFound

- application/json

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

### #/components/responses/ErrorTooManyRequests

- application/json

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```

### #/components/responses/ErrorInternal

- application/json

```ts
// Schema of all error responses
{
  code: string
  message: string
  // Schema of error details
  issues: {
    code?: string
    param?: string
    message: string
  }[]
}
```