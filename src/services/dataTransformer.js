/**
 * Transform Qubic data to DEXTools format
 */
class DataTransformer {
  // Transform a Qubic tick to a DEXTools block
  transformTickToBlock(tick) {
    if (!tick) {
      return {
        blockNumber: 0,
        blockTimestamp: Math.floor(Date.now() / 1000)
      };
    }
    
    return {
      blockNumber: tick.tickNumber || tick.number || 0, 
      blockTimestamp: Math.floor((tick.timestamp || Date.now()) / 1000) // Convert milliseconds to seconds
    };
  }

  // Transform a Qubic asset to a DEXTools asset
  transformAssetToAsset(asset) {
    return {
      id: asset.id,
      name: asset.name || `Asset ${asset.id.substring(0, 8)}`,
      symbol: asset.symbol || asset.id.substring(0, 4).toUpperCase(),
      totalSupply: (asset.totalSupply || "0").toString(),
      circulatingSupply: (asset.circulatingSupply || "0").toString(),
      holdersCount: asset.holdersCount || 0
    };
  }

  // Transform Qubic asset holders to DEXTools asset holders
  transformAssetHolders(assetId, holders, totalCount) {
    return {
      id: assetId,
      totalHoldersCount: totalCount,
      holders: holders.map(holder => ({
        address: holder.address,
        quantity: holder.quantity
      }))
    };
  }

  // Transform a Qubic exchange to a DEXTools exchange
  transformExchangeToExchange(exchange) {
    return {
      factoryAddress: exchange.factoryAddress,
      name: exchange.name || `Qubic DEX`,
      logoURL: exchange.logoURL || "https://qubic.org/logo.png"
    };
  }

  // Transform a Qubic pair to a DEXTools pair
  transformPairToPair(pair) {
    return {
      id: pair.id,
      asset0Id: pair.token0,
      asset1Id: pair.token1,
      createdAtBlockNumber: pair.createdAtTickNumber || 0,
      createdAtBlockTimestamp: Math.floor((pair.createdAtTimestamp || Date.now()) / 1000),
      createdAtTxnId: pair.createdAtTxId || "0x0",
      factoryAddress: pair.factoryAddress || "qubic-factory",
      feeBps: this._calculateFeeBps(pair.fee)
    };
  }

  // Calculate fee in basis points
  _calculateFeeBps(fee) {
    if (!fee) return 30; // Default to 0.3%
    if (fee <= 1) return Math.round(fee * 10000); // If decimal (e.g. 0.003), convert to basis points
    return fee; // If already in basis points
  }

  // Format amount to string with required decimal format
  _formatAmount(amount) {
    if (amount === undefined || amount === null) return '0.0';
    if (typeof amount === 'string') return amount;
    if (typeof amount === 'number') return amount.toFixed(6);
    return '0.0';
  }

  // Transform Qubic transactions to DEXTools events
  transformTransactionsToEvents(transactions, tickData) {
    const events = [];
    
    if (!Array.isArray(transactions)) {
      console.warn('Transactions is not an array:', transactions);
      return [];
    }
    
    for (const txn of transactions) {
      try {
        // Skip transactions without type
        if (!txn.type) continue;
        
        // Create the base event object
        const baseEvent = {
          block: this.transformTickToBlock(tickData),
          txnId: txn.id || txn.txId || `0x${Math.random().toString(36).substring(7)}`,
          txnIndex: txn.index || 0,
          eventIndex: txn.eventIndex || 0,
          maker: txn.sender || txn.from || "unknown",
          pairId: txn.pairId || "unknown",
          eventType: this._mapEventType(txn.type)
        };

        // Skip events we can't map to DEXTools event types
        if (!baseEvent.eventType) continue;

        // Add event-specific fields based on the event type
        switch (txn.type) {
          case 'PAIR_CREATED':
          case 'PAIR_CREATE':
          case 'CREATE_PAIR':
            events.push({
              ...baseEvent,
              eventType: 'creation'
            });
            break;
            
          case 'SWAP':
          case 'EXCHANGE':
            events.push({
              ...baseEvent,
              eventType: 'swap',
              asset0In: this._formatAmount(txn.amount0In),
              asset1Out: this._formatAmount(txn.amount1Out),
              asset0Out: this._formatAmount(txn.amount0Out),
              asset1In: this._formatAmount(txn.amount1In),
              reserves: {
                asset0: this._formatAmount(txn.reserves?.token0 || txn.reserves?.asset0),
                asset1: this._formatAmount(txn.reserves?.token1 || txn.reserves?.asset1)
              }
            });
            break;
            
          case 'ADD_LIQUIDITY':
          case 'JOIN_POOL':
          case 'PROVIDE_LIQUIDITY':
            events.push({
              ...baseEvent,
              eventType: 'join',
              amount0: this._formatAmount(txn.amount0),
              amount1: this._formatAmount(txn.amount1),
              reserves: {
                asset0: this._formatAmount(txn.reserves?.token0 || txn.reserves?.asset0),
                asset1: this._formatAmount(txn.reserves?.token1 || txn.reserves?.asset1)
              }
            });
            break;
            
          case 'REMOVE_LIQUIDITY':
          case 'EXIT_POOL':
          case 'WITHDRAW_LIQUIDITY':
            events.push({
              ...baseEvent,
              eventType: 'exit',
              amount0: this._formatAmount(txn.amount0),
              amount1: this._formatAmount(txn.amount1),
              reserves: {
                asset0: this._formatAmount(txn.reserves?.token0 || txn.reserves?.asset0),
                asset1: this._formatAmount(txn.reserves?.token1 || txn.reserves?.asset1)
              }
            });
            break;
        }
      } catch (error) {
        console.error('Error transforming transaction to event:', error);
        // Continue with next transaction
      }
    }
    
    return events;
  }

  // Map Qubic event types to DEXTools event types
  _mapEventType(qubicEventType) {
    const eventTypeMap = {
      'PAIR_CREATED': 'creation',
      'PAIR_CREATE': 'creation',
      'CREATE_PAIR': 'creation',
      'SWAP': 'swap',
      'EXCHANGE': 'swap',
      'ADD_LIQUIDITY': 'join',
      'JOIN_POOL': 'join',
      'PROVIDE_LIQUIDITY': 'join',
      'REMOVE_LIQUIDITY': 'exit',
      'EXIT_POOL': 'exit',
      'WITHDRAW_LIQUIDITY': 'exit'
    };
    
    return eventTypeMap[qubicEventType] || null;
  }
}

module.exports = new DataTransformer(); 