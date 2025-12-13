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
      if (amountOut === 0n) return '0';
      return ethers.formatUnits((amountIn * 10n ** 18n) / amountOut, 18);
    } catch (err) {
      console.error('Error calculating token price:', err);
      return '0';
    }
  };

  // TokenBought event - ethers.js v6 format
  ws_contract.on('TokenBought', async (
    tokenAddress: string,
    buyer: string,
    ethAmount: bigint,
    tokenAmount: bigint,
    newEthReserves: bigint,
    newVirtualEthReserves: bigint,
    newVirtualTokenReserves: bigint,
    event: any
  ) => {
    try {
      console.log(`✅ TokenBought Event Detected on chain ${chainId}`);
      console.log(`   Token: ${tokenAddress}`);
      console.log(`   Buyer: ${buyer}`);
      console.log(`   TX Hash: ${event.log?.transactionHash || event.transactionHash}`);
      console.log(`   Block: ${event.log?.blockNumber || event.blockNumber}`);

      // Use the chainId from trackChain function (already correct)
      const txHash = event.log?.transactionHash || event.transactionHash;
      const blockNumber = event.log?.blockNumber || event.blockNumber;

      const block = await chainProvider.getBlock(blockNumber);
      const blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();

      const eventData = {
        txHash: txHash,
        tokenAddress: tokenAddress,
        senderAddress: factoryAddress, // Use chain-specific factory address
        recipientAddress: buyer,
        ethAmount: ethAmount,
        tokenAmount: tokenAmount,
        newEthReserves: newEthReserves, // Add newEthReserves for graduation progress calculation
        blockNumber: blockNumber,
        blockTimestamp: blockTimestamp,
        type: 'Bought',
        chainId: chainId,
      };
      
      const priceData = {
        tokenAddress: tokenAddress,
        tokenPrice: calculatePrice(newVirtualEthReserves, newVirtualTokenReserves),
        blockNumber: block?.number || blockNumber,
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
    tokenAddress: string,
    seller: string,
    tokenAmount: bigint,
    ethAmount: bigint,
    newEthReserves: bigint,
    newVirtualEthReserves: bigint,
    newVirtualTokenReserves: bigint,
    event: any
  ) => {
    try {
      console.log(`✅ TokenSold Event Detected on chain ${chainId}`);
      console.log(`   Token: ${tokenAddress}`);
      console.log(`   Seller: ${seller}`);
      console.log(`   TX Hash: ${event.log?.transactionHash || event.transactionHash}`);
      console.log(`   Block: ${event.log?.blockNumber || event.blockNumber}`);

      // Use the chainId from trackChain function (already correct)
      const txHash = event.log?.transactionHash || event.transactionHash;
      const blockNumber = event.log?.blockNumber || event.blockNumber;

      const block = await chainProvider.getBlock(blockNumber);
      const blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();

      const eventData = {
        txHash: txHash,
        tokenAddress: tokenAddress,
        senderAddress: seller,
        recipientAddress: factoryAddress, // Use chain-specific factory address
        ethAmount: ethAmount,
        tokenAmount: tokenAmount,
        newEthReserves: newEthReserves, // Add newEthReserves for graduation progress calculation
        blockNumber: blockNumber,
        blockTimestamp: blockTimestamp,
        type: 'Sold',
        chainId: chainId,
      };
      
      const priceData = {
        tokenAddress: tokenAddress,
        tokenPrice: calculatePrice(newVirtualEthReserves, newVirtualTokenReserves),
        blockNumber: block?.number || blockNumber,
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
    tokenAddress: string,
    creator: string,
    name: string,
    symbol: string,
    description: string,
    uri: string,
    totalSupply: bigint,
    virtualEthReserves: bigint,
    virtualTokenReserves: bigint,
    graduationEth: bigint,
    event: any
  ) => {
    try {
      console.log(`✅ TokenCreated Event Detected on chain ${chainId}`);
      console.log(`   Token Address: ${tokenAddress}`);
      console.log(`   Creator: ${creator}`);
      console.log(`   TX Hash: ${event.log?.transactionHash || event.transactionHash}`);
      console.log(`   Block: ${event.log?.blockNumber || event.blockNumber}`);

      // Use the chainId from trackChain function (already correct)
      const eventData = {
        address: tokenAddress,
        creatorAddress: creator,
        name: name,
        symbol: symbol,
        description: description || '',
        logo: uri || '/chats/noimg.svg',
        totalSupply: totalSupply.toString(), // Save totalSupply from event
        graduationEth: graduationEth.toString(), // Save graduationEth from event
        chainId: chainId,
      };

      const blockNumber = event.log?.blockNumber || event.blockNumber;
      const block = await chainProvider.getBlock(blockNumber);
      const blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
      
      const priceData = {
        tokenAddress: tokenAddress,
        tokenPrice: calculatePrice(virtualEthReserves, virtualTokenReserves),
        blockNumber: block?.number || blockNumber,
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
