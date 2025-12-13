import { ethers } from 'ethers';
import { getWsContract, getProvider, getFactoryAddressForChain, getConfiguredChains } from '../config/blockchain';
import { saveTradeEvent, saveCreatedEvent } from './handler';

/**
 * Track events for a specific chain
 */
const trackChain = (chainId: number): void => {
  const ws_contract = getWsContract(chainId);
  if (!ws_contract) {
    console.warn(`⚠️ WebSocket contract not available for chain ${chainId}. Tracking disabled for this chain.`);
    return;
  }

  const chainProvider = getProvider(chainId);
  const factoryAddress = getFactoryAddressForChain(chainId);
  
  console.log(`🔍 Starting token trading tracking for chain ${chainId}...`);
  console.log(`📡 WebSocket contract address: ${factoryAddress}`);

  // Removed getNetwork() call - it causes timeouts and we already know the chainId
  // The provider is created with chainId, so no need to verify via RPC call
  // Just log the chainId we're using
  const chainNames: Record<number, string> = {
    1: 'Ethereum',
    8453: 'Base',
    42161: 'Arbitrum',
    84532: 'Base Sepolia',
  };
  console.log(`🌐 Using chainId: ${chainId} (${chainNames[chainId] || 'Unknown'})`);

  // Helper function to safely parse price
  const calculatePrice = (amountIn: bigint, amountOut: bigint): string => {
    try {
      if (amountOut === 0n || amountIn === 0n) return '0';
      
      // Calculate: (virtualEthReserves * 1e18) / virtualTokenReserves
      // This gives price in wei units (scaled by 1e18)
      const priceInWei = (amountIn * 10n ** 18n) / amountOut;
      
      // Convert to ETH: formatUnits divides by 1e18
      const priceInEth = ethers.formatUnits(priceInWei, 18);
      
      // Validate the result is reasonable
      // Price should typically be < 1 ETH per token (for most tokens)
      // But allow up to 1000 ETH per token as a safety limit
      const priceValue = parseFloat(priceInEth);
      if (!isFinite(priceValue) || priceValue < 0 || priceValue > 1000) {
        console.error('❌ Invalid price calculated:', {
          price: priceInEth,
          priceValue,
          amountIn: amountIn.toString(),
          amountOut: amountOut.toString(),
          amountInEth: ethers.formatUnits(amountIn, 18),
          amountOutTokens: ethers.formatUnits(amountOut, 18),
        });
        return '0';
      }
      
      return priceInEth;
    } catch (err) {
      console.error('Error calculating token price:', err);
      return '0';
    }
  };

  // TokenBought event - ethers.js v6 format
  // Note: In ethers.js v6, contract.on() callback receives (args..., eventLog)
  // The event object is passed as the last parameter, but we need to access it correctly
  ws_contract.on('TokenBought', async (
    ...args: any[]
  ) => {
    try {
      // Extract event arguments
      // TokenBought event signature from contract:
      // event TokenBought(address indexed tokenAddress, address indexed buyer, uint256 ethAmount, uint256 tokenAmount,
      //                   uint256 newEthReserves, uint256 newTokenReserves, uint256 newVirtualEthReserves, uint256 newVirtualTokenReserves)
      // args[0]: tokenAddress, args[1]: buyer, args[2]: ethAmount, args[3]: tokenAmount,
      // args[4]: newEthReserves, args[5]: newTokenReserves, args[6]: newVirtualEthReserves, args[7]: newVirtualTokenReserves
      // args[8]: eventLog object (added by ethers.js)
      const tokenAddress = args[0] as string;
      const buyer = args[1] as string;
      const ethAmount = args[2] as bigint;
      const tokenAmount = args[3] as bigint;
      const newEthReserves = args[4] as bigint;
      // const newTokenReserves = args[5] as bigint; // Not used currently
      const newVirtualEthReserves = args[6] as bigint; // FIXED: was args[5]
      const newVirtualTokenReserves = args[7] as bigint; // FIXED: was args[6]
      const eventLog = args[8] as any; // The event log object is at index 8

      console.log(`✅ TokenBought Event Detected on chain ${chainId}`);
      console.log(`   Token: ${tokenAddress}`);
      console.log(`   Buyer: ${buyer}`);
      console.log(`   Args length: ${args.length}`);
      
      // Debug: Log event structure
      console.log('🔍 Event log type:', typeof eventLog);
      console.log('🔍 Event log keys:', eventLog && typeof eventLog === 'object' ? Object.keys(eventLog) : 'not an object');
      
      let txHash: string | undefined = undefined;
      let blockNumber: number | undefined = undefined;

      // Try to get from eventLog.log (ethers.js v6 structure)
      if (eventLog && typeof eventLog === 'object' && eventLog.log) {
        txHash = eventLog.log.transactionHash || eventLog.log.hash;
        blockNumber = eventLog.log.blockNumber;
        if (txHash) console.log('   ✅ Found in eventLog.log');
      }

      // Try direct properties on eventLog
      if (!txHash && eventLog && typeof eventLog === 'object') {
        txHash = eventLog.transactionHash || eventLog.hash;
        blockNumber = eventLog.blockNumber;
        if (txHash) console.log('   ✅ Found in eventLog direct');
      }

      // If still not found, try to get from the provider using the event filter
      if (!txHash || !blockNumber) {
        try {
          const latestBlock = await chainProvider.getBlockNumber();
          const filter = ws_contract.filters.TokenBought(tokenAddress);
          const events = await ws_contract.queryFilter(filter, latestBlock - 10, latestBlock);
          
          if (events.length > 0) {
            const latestEvent = events[events.length - 1] as any;
            if (latestEvent) {
              if (!txHash && latestEvent.log?.transactionHash) txHash = latestEvent.log.transactionHash;
              if (!txHash && latestEvent.transactionHash) txHash = latestEvent.transactionHash;
              if (!blockNumber && latestEvent.log?.blockNumber) blockNumber = latestEvent.log.blockNumber;
              if (!blockNumber && latestEvent.blockNumber) blockNumber = latestEvent.blockNumber;
              console.log('   ✅ Found from queryFilter');
            }
          }
        } catch (err: any) {
          console.warn('⚠️ Could not get from queryFilter:', err?.message || err);
        }
      }

      console.log(`   TX Hash: ${txHash || 'NOT FOUND'}`);
      console.log(`   Block: ${blockNumber || 'NOT FOUND'}`);

      // Validate required fields
      if (!txHash) {
        console.error('❌ TokenBought event missing txHash after all extraction attempts');
        console.error('   Event log:', eventLog);
        console.error('   All args:', args.map((arg, i) => `args[${i}]: ${typeof arg === 'bigint' ? arg.toString() : typeof arg}`));
        return;
      }

      if (!tokenAddress) {
        console.error('❌ TokenBought event missing tokenAddress');
        return;
      }

      // Get block timestamp
      let blockTimestamp = new Date();
      if (blockNumber) {
        try {
          const block = await chainProvider.getBlock(blockNumber);
          blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
        } catch (err) {
          console.warn('⚠️ Could not get block timestamp:', err);
        }
      } else if (txHash) {
        // If we have txHash but no blockNumber, get it from receipt
        try {
          const receipt = await chainProvider.getTransactionReceipt(txHash);
          if (receipt) {
            blockNumber = receipt.blockNumber;
            const block = await chainProvider.getBlock(blockNumber);
            blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
            console.log(`   ✅ Got blockNumber and timestamp from receipt: ${blockNumber}`);
          }
        } catch (err) {
          console.warn('⚠️ Could not get block from receipt:', err);
        }
      }

      const eventData = {
        txHash: txHash,
        tokenAddress: tokenAddress,
        senderAddress: factoryAddress, // Use chain-specific factory address
        recipientAddress: buyer,
        ethAmount: ethAmount,
        tokenAmount: tokenAmount,
        newEthReserves: newEthReserves, // Add newEthReserves for graduation progress calculation
        blockNumber: blockNumber || 0,
        blockTimestamp: blockTimestamp,
        type: 'Bought',
        chainId: chainId,
      };
      
      const priceData = {
        tokenAddress: tokenAddress,
        tokenPrice: calculatePrice(newVirtualEthReserves, newVirtualTokenReserves),
        blockNumber: blockNumber || 0,
        timestamp: blockTimestamp,
        chainId: chainId,
      };

      await saveTradeEvent(eventData, priceData);
      console.log(`✅ TokenBought event processed successfully`);
    } catch (err) {
      console.error('❌ Error handling TokenBought event:', err);
    }
  });

  // TokenSold event - ethers.js v6 format
  ws_contract.on('TokenSold', async (
    ...args: any[]
  ) => {
    try {
      // Extract event arguments
      // TokenSold event signature from contract:
      // event TokenSold(address indexed tokenAddress, address indexed seller, uint256 tokenAmount, uint256 ethAmount,
      //                 uint256 newEthReserves, uint256 newTokenReserves, uint256 newVirtualEthReserves, uint256 newVirtualTokenReserves)
      // args[0]: tokenAddress, args[1]: seller, args[2]: tokenAmount, args[3]: ethAmount,
      // args[4]: newEthReserves, args[5]: newTokenReserves, args[6]: newVirtualEthReserves, args[7]: newVirtualTokenReserves
      // args[8]: eventLog object (added by ethers.js)
      const tokenAddress = args[0] as string;
      const seller = args[1] as string;
      const tokenAmount = args[2] as bigint;
      const ethAmount = args[3] as bigint;
      const newEthReserves = args[4] as bigint;
      // const newTokenReserves = args[5] as bigint; // Not used currently
      const newVirtualEthReserves = args[6] as bigint; // FIXED: was args[5]
      const newVirtualTokenReserves = args[7] as bigint; // FIXED: was args[6]
      const eventLog = args[8] as any; // The event log object is at index 8

      console.log(`✅ TokenSold Event Detected on chain ${chainId}`);
      console.log(`   Token: ${tokenAddress}`);
      console.log(`   Seller: ${seller}`);

      let txHash: string | undefined = undefined;
      let blockNumber: number | undefined = undefined;

      // Try to get from eventLog.log
      if (eventLog?.log) {
        txHash = eventLog.log.transactionHash || eventLog.log.hash;
        blockNumber = eventLog.log.blockNumber;
      }

      // Try direct properties
      if (!txHash && eventLog) {
        txHash = eventLog.transactionHash || eventLog.hash;
        blockNumber = eventLog.blockNumber;
      }

      // Fallback: query recent events
      if (!txHash || !blockNumber) {
        try {
          const latestBlock = await chainProvider.getBlockNumber();
          const filter = ws_contract.filters.TokenSold(tokenAddress);
          const events = await ws_contract.queryFilter(filter, latestBlock - 10, latestBlock);
          if (events.length > 0) {
            const latestEvent = events[events.length - 1] as any;
            if (latestEvent) {
              if (!txHash && latestEvent.log?.transactionHash) txHash = latestEvent.log.transactionHash;
              if (!txHash && latestEvent.transactionHash) txHash = latestEvent.transactionHash;
              if (!blockNumber && latestEvent.log?.blockNumber) blockNumber = latestEvent.log.blockNumber;
              if (!blockNumber && latestEvent.blockNumber) blockNumber = latestEvent.blockNumber;
              console.log('   ✅ Found from queryFilter');
            }
          }
        } catch (err: any) {
          console.warn('⚠️ Could not get from queryFilter:', err?.message || err);
        }
      }

      console.log(`   TX Hash: ${txHash || 'NOT FOUND'}`);
      console.log(`   Block: ${blockNumber || 'NOT FOUND'}`);

      if (!txHash) {
        console.error('❌ TokenSold event missing txHash');
        return;
      }

      if (!tokenAddress) {
        console.error('❌ TokenSold event missing tokenAddress');
        return;
      }

      // Get block timestamp
      let blockTimestamp = new Date();
      if (blockNumber) {
        try {
          const block = await chainProvider.getBlock(blockNumber);
          blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
        } catch (err) {
          console.warn('⚠️ Could not get block timestamp:', err);
        }
      } else if (txHash) {
        try {
          const receipt = await chainProvider.getTransactionReceipt(txHash);
          if (receipt) {
            blockNumber = receipt.blockNumber;
            const block = await chainProvider.getBlock(blockNumber);
            blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
          }
        } catch (err) {
          console.warn('⚠️ Could not get block from receipt:', err);
        }
      }

      const eventData = {
        txHash: txHash,
        tokenAddress: tokenAddress,
        senderAddress: seller,
        recipientAddress: factoryAddress,
        ethAmount: ethAmount,
        tokenAmount: tokenAmount,
        newEthReserves: newEthReserves,
        blockNumber: blockNumber || 0,
        blockTimestamp: blockTimestamp,
        type: 'Sold',
        chainId: chainId,
      };
      
      const priceData = {
        tokenAddress: tokenAddress,
        tokenPrice: calculatePrice(newVirtualEthReserves, newVirtualTokenReserves),
        blockNumber: blockNumber || 0,
        timestamp: blockTimestamp,
        chainId: chainId,
      };

      await saveTradeEvent(eventData, priceData);
      console.log(`✅ TokenSold event processed successfully`);
    } catch (err) {
      console.error('❌ Error handling TokenSold event:', err);
    }
  });

  // TokenCreated event - ethers.js v6 format
  ws_contract.on('TokenCreated', async (
    ...args: any[]
  ) => {
    try {
      // Extract event arguments
      // TokenCreated event signature from contract:
      // event TokenCreated(address indexed tokenAddress, address indexed creator, string name, string symbol, string description, string uri, uint256 totalSupply, uint256 virtualEthReserves, uint256 virtualTokenReserves, uint256 graduationEth)
      // args[0]: tokenAddress, args[1]: creator, args[2]: name, args[3]: symbol, args[4]: description, args[5]: uri,
      // args[6]: totalSupply, args[7]: virtualEthReserves, args[8]: virtualTokenReserves, args[9]: graduationEth
      // args[10]: eventLog object (added by ethers.js)
      const tokenAddress = args[0] as string;
      const creator = args[1] as string;
      const name = args[2] as string;
      const symbol = args[3] as string;
      const description = args[4] as string;
      const uri = args[5] as string;
      const totalSupply = args[6] as bigint;
      const virtualEthReserves = args[7] as bigint;
      const virtualTokenReserves = args[8] as bigint;
      const graduationEth = args[9] as bigint;
      const eventLog = args[10] as any; // The event log object is at index 10

      console.log(`✅ TokenCreated Event Detected on chain ${chainId}`);
      console.log(`   Token Address: ${tokenAddress}`);
      console.log(`   Creator: ${creator}`);

      if (!tokenAddress) {
        console.error('❌ TokenCreated event missing tokenAddress');
        return;
      }

      let txHash: string | undefined = undefined;
      let blockNumber: number | undefined = undefined;

      // Try to get from eventLog.log
      if (eventLog?.log) {
        txHash = eventLog.log.transactionHash || eventLog.log.hash;
        blockNumber = eventLog.log.blockNumber;
      }

      // Try direct properties
      if (!txHash && eventLog) {
        txHash = eventLog.transactionHash || eventLog.hash;
        blockNumber = eventLog.blockNumber;
      }

      // Fallback: query recent events
      if (!txHash || !blockNumber) {
        try {
          const latestBlock = await chainProvider.getBlockNumber();
          const filter = ws_contract.filters.TokenCreated();
          const events = await ws_contract.queryFilter(filter, latestBlock - 10, latestBlock);
          if (events.length > 0) {
            const latestEvent = events.find((e: any) => e.args && e.args[0]?.toLowerCase() === tokenAddress.toLowerCase()) as any;
            if (latestEvent) {
              if (!txHash && latestEvent.log?.transactionHash) txHash = latestEvent.log.transactionHash;
              if (!txHash && latestEvent.transactionHash) txHash = latestEvent.transactionHash;
              if (!blockNumber && latestEvent.log?.blockNumber) blockNumber = latestEvent.log.blockNumber;
              if (!blockNumber && latestEvent.blockNumber) blockNumber = latestEvent.blockNumber;
              console.log('   ✅ Found from queryFilter');
            }
          }
        } catch (err: any) {
          console.warn('⚠️ Could not get from queryFilter:', err?.message || err);
        }
      }

      console.log(`   TX Hash: ${txHash || 'NOT FOUND'}`);
      console.log(`   Block: ${blockNumber || 'NOT FOUND'}`);

      if (!txHash) {
        console.error('❌ TokenCreated event missing txHash');
        return;
      }

      const eventData = {
        address: tokenAddress,
        creatorAddress: creator,
        name: name,
        symbol: symbol,
        description: description || '',
        logo: uri || '/chats/noimg.svg',
        totalSupply: totalSupply.toString(),
        graduationEth: graduationEth.toString(),
        chainId: chainId,
      };

      // Get block timestamp
      let blockTimestamp = new Date();
      if (blockNumber) {
        try {
          const block = await chainProvider.getBlock(blockNumber);
          blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
        } catch (err) {
          console.warn('⚠️ Could not get block timestamp:', err);
        }
      } else if (txHash) {
        try {
          const receipt = await chainProvider.getTransactionReceipt(txHash);
          if (receipt) {
            blockNumber = receipt.blockNumber;
            const block = await chainProvider.getBlock(blockNumber);
            blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
          }
        } catch (err) {
          console.warn('⚠️ Could not get block from receipt:', err);
        }
      }
      
      const priceData = {
        tokenAddress: tokenAddress,
        tokenPrice: calculatePrice(virtualEthReserves, virtualTokenReserves),
        blockNumber: blockNumber || 0,
        timestamp: blockTimestamp,
        chainId: chainId,
      };

      await saveCreatedEvent(eventData, priceData);
      console.log(`✅ Token creation event processed successfully`);
    } catch (err) {
      console.error('❌ Error handling TokenCreated event:', err);
    }
  });

  // Add error handlers for WebSocket connection
  const wsProvider = ws_contract.provider as any;
  if (wsProvider && 'on' in wsProvider) {
    // Handle WebSocket provider errors (supported event)
    try {
      wsProvider.on('error', (error: any) => {
        console.error(`❌ WebSocket provider error for chain ${chainId}:`, error);
        console.error('   Error details:', error.message || error);
        console.warn(`⚠️ Event tracking may be interrupted for chain ${chainId}. Check WebSocket connection.`);
      });
    } catch (err) {
      console.warn(`⚠️ Could not attach error handler to WebSocket provider for chain ${chainId}`);
    }

    // Monitor connection health by checking the underlying WebSocket
    if (wsProvider._websocket) {
      const underlyingWs = wsProvider._websocket;
      
      underlyingWs.on('error', (error: any) => {
        console.error(`❌ Underlying WebSocket error for chain ${chainId}:`, error);
      });

      underlyingWs.on('close', (code: number, reason: Buffer) => {
        console.warn(`⚠️ WebSocket connection closed for chain ${chainId}. Code: ${code}`);
        if (reason) {
          console.warn(`   Reason: ${reason.toString()}`);
        }
        console.warn(`⚠️ Event tracking is now disabled for chain ${chainId}. Please restart the server to re-enable.`);
      });

      underlyingWs.on('open', () => {
        console.log(`✅ WebSocket connection established for chain ${chainId}`);
      });
    }
  }

  console.log(`✅ Token trading tracking initialized for chain ${chainId}`);
};

/**
 * Track events for all configured chains
 */
export const trackTrading = (): void => {
  const configuredChains = getConfiguredChains();
  
  if (configuredChains.length === 0) {
    console.warn('⚠️ No chains configured. Trading tracking disabled.');
    return;
  }

  console.log(`🔍 Starting multi-chain token trading tracking for ${configuredChains.length} chain(s)...`);
  
  // Track events for each configured chain
  for (const chainId of configuredChains) {
    try {
      trackChain(chainId);
    } catch (error: any) {
      console.error(`❌ Failed to initialize tracking for chain ${chainId}:`, error.message);
    }
  }
  
  console.log('✅ Multi-chain token trading tracking initialization complete');
};
