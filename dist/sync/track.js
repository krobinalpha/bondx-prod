"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackTrading = void 0;
const ethers_1 = require("ethers");
const blockchain_1 = require("../config/blockchain");
const handler_1 = require("./handler");
// Store active tracking connections to prevent duplicates and enable cleanup
const activeTracking = new Map();
// Helper to remove all event listeners from a contract
const removeAllEventListeners = (contract) => {
    try {
        contract.removeAllListeners('TokenBought');
        contract.removeAllListeners('TokenSold');
        contract.removeAllListeners('TokenCreated');
        contract.removeAllListeners('TokenGraduated');
    }
    catch (err) {
        // Ignore errors if listeners don't exist
    }
};
// Reconnection function with exponential backoff
const reconnectWebSocket = (chainId, retryCount = 0) => {
    const maxRetries = 10;
    const baseDelay = 2000; // Start with 2 seconds
    const maxDelay = 60000; // Max 60 seconds
    if (retryCount >= maxRetries) {
        console.error(`❌ Max reconnection attempts (${maxRetries}) reached for chain ${chainId}. Stopping reconnection.`);
        activeTracking.delete(chainId);
        return;
    }
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s, 60s...
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    setTimeout(() => {
        try {
            trackChain(chainId);
        }
        catch (error) {
            console.error(`❌ Reconnection attempt ${retryCount + 1} failed for chain ${chainId}:`, error.message);
            // Retry with incremented count
            reconnectWebSocket(chainId, retryCount + 1);
        }
    }, delay);
};
/**
 * Track events for a specific chain
 * This function is idempotent - can be called multiple times safely
 */
const trackChain = (chainId) => {
    // Clean up existing connection if it exists (for reconnection)
    const existing = activeTracking.get(chainId);
    if (existing) {
        try {
            removeAllEventListeners(existing.contract);
            // Don't destroy provider here - let it be garbage collected naturally
            // Destroying might cause issues if it's still in use
        }
        catch {
            // Ignore cleanup errors
        }
        activeTracking.delete(chainId);
    }
    const ws_contract = (0, blockchain_1.getWsContract)(chainId);
    if (!ws_contract) {
        activeTracking.delete(chainId);
        return;
    }
    const wsProvider = ws_contract.provider;
    const chainProvider = (0, blockchain_1.getProvider)(chainId);
    const factoryAddress = (0, blockchain_1.getFactoryAddressForChain)(chainId);
    // Store connection info for cleanup and reconnection
    activeTracking.set(chainId, {
        contract: ws_contract,
        provider: wsProvider
    });
    // Helper function to safely parse price
    const calculatePrice = (amountIn, amountOut) => {
        try {
            if (amountOut === 0n || amountIn === 0n)
                return '0';
            // Calculate: (virtualEthReserves * 1e18) / virtualTokenReserves
            // This gives price in wei units (scaled by 1e18)
            const priceInWei = (amountIn * 10n ** 18n) / amountOut;
            // Convert to ETH: formatUnits divides by 1e18
            const priceInEth = ethers_1.ethers.formatUnits(priceInWei, 18);
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
                    amountInEth: ethers_1.ethers.formatUnits(amountIn, 18),
                    amountOutTokens: ethers_1.ethers.formatUnits(amountOut, 18),
                });
                return '0';
            }
            return priceInEth;
        }
        catch (err) {
            console.error('Error calculating token price:', err);
            return '0';
        }
    };
    // TokenBought event - ethers.js v6 format
    // Note: In ethers.js v6, contract.on() callback receives (args..., eventLog)
    // The event object is passed as the last parameter, but we need to access it correctly
    ws_contract.on('TokenBought', async (...args) => {
        try {
            // Extract event arguments
            // TokenBought event signature from contract:
            // event TokenBought(address indexed tokenAddress, address indexed buyer, uint256 ethAmount, uint256 tokenAmount,
            //                   uint256 newEthReserves, uint256 newTokenReserves, uint256 newVirtualEthReserves, uint256 newVirtualTokenReserves)
            // args[0]: tokenAddress, args[1]: buyer, args[2]: ethAmount, args[3]: tokenAmount,
            // args[4]: newEthReserves, args[5]: newTokenReserves, args[6]: newVirtualEthReserves, args[7]: newVirtualTokenReserves
            // args[8]: eventLog object (added by ethers.js)
            const tokenAddress = args[0];
            const buyer = args[1];
            const ethAmount = args[2];
            const tokenAmount = args[3];
            const newEthReserves = args[4];
            // const newTokenReserves = args[5] as bigint; // Not used currently
            const newVirtualEthReserves = args[6]; // FIXED: was args[5]
            const newVirtualTokenReserves = args[7]; // FIXED: was args[6]
            const eventLog = args[8]; // The event log object is at index 8
            let txHash = undefined;
            let blockNumber = undefined;
            // Try to get from eventLog.log (ethers.js v6 structure)
            if (eventLog && typeof eventLog === 'object' && eventLog.log) {
                txHash = eventLog.log.transactionHash || eventLog.log.hash;
                blockNumber = eventLog.log.blockNumber;
            }
            // Try direct properties on eventLog
            if (!txHash && eventLog && typeof eventLog === 'object') {
                txHash = eventLog.transactionHash || eventLog.hash;
                blockNumber = eventLog.blockNumber;
            }
            // If still not found, try to get from the provider using the event filter
            if (!txHash || !blockNumber) {
                try {
                    const latestBlock = await chainProvider.getBlockNumber();
                    const filter = ws_contract.filters.TokenBought(tokenAddress);
                    const events = await ws_contract.queryFilter(filter, latestBlock - 10, latestBlock);
                    if (events.length > 0) {
                        const latestEvent = events[events.length - 1];
                        if (latestEvent) {
                            if (!txHash && latestEvent.log?.transactionHash)
                                txHash = latestEvent.log.transactionHash;
                            if (!txHash && latestEvent.transactionHash)
                                txHash = latestEvent.transactionHash;
                            if (!blockNumber && latestEvent.log?.blockNumber)
                                blockNumber = latestEvent.log.blockNumber;
                            if (!blockNumber && latestEvent.blockNumber)
                                blockNumber = latestEvent.blockNumber;
                        }
                    }
                }
                catch {
                    // Could not get from queryFilter - continue with other methods
                }
            }
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
                }
                catch {
                    // Could not get block timestamp - use current time
                }
            }
            else if (txHash) {
                // If we have txHash but no blockNumber, get it from receipt
                try {
                    const receipt = await chainProvider.getTransactionReceipt(txHash);
                    if (receipt) {
                        blockNumber = receipt.blockNumber;
                        const block = await chainProvider.getBlock(blockNumber);
                        blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
                    }
                }
                catch {
                    // Could not get block from receipt - use current time
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
            await (0, handler_1.saveTradeEvent)(eventData, priceData);
        }
        catch (err) {
            console.error('❌ Error handling TokenBought event:', err);
        }
    });
    // TokenSold event - ethers.js v6 format
    ws_contract.on('TokenSold', async (...args) => {
        try {
            // Extract event arguments
            // TokenSold event signature from contract:
            // event TokenSold(address indexed tokenAddress, address indexed seller, uint256 tokenAmount, uint256 ethAmount,
            //                 uint256 newEthReserves, uint256 newTokenReserves, uint256 newVirtualEthReserves, uint256 newVirtualTokenReserves)
            // args[0]: tokenAddress, args[1]: seller, args[2]: tokenAmount, args[3]: ethAmount,
            // args[4]: newEthReserves, args[5]: newTokenReserves, args[6]: newVirtualEthReserves, args[7]: newVirtualTokenReserves
            // args[8]: eventLog object (added by ethers.js)
            const tokenAddress = args[0];
            const seller = args[1];
            const tokenAmount = args[2];
            const ethAmount = args[3];
            const newEthReserves = args[4];
            // const newTokenReserves = args[5] as bigint; // Not used currently
            const newVirtualEthReserves = args[6]; // FIXED: was args[5]
            const newVirtualTokenReserves = args[7]; // FIXED: was args[6]
            const eventLog = args[8]; // The event log object is at index 8
            let txHash = undefined;
            let blockNumber = undefined;
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
                        const latestEvent = events[events.length - 1];
                        if (latestEvent) {
                            if (!txHash && latestEvent.log?.transactionHash)
                                txHash = latestEvent.log.transactionHash;
                            if (!txHash && latestEvent.transactionHash)
                                txHash = latestEvent.transactionHash;
                            if (!blockNumber && latestEvent.log?.blockNumber)
                                blockNumber = latestEvent.log.blockNumber;
                            if (!blockNumber && latestEvent.blockNumber)
                                blockNumber = latestEvent.blockNumber;
                        }
                    }
                }
                catch {
                    // Could not get from queryFilter - continue with other methods
                }
            }
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
                }
                catch {
                    // Could not get block timestamp - use current time
                }
            }
            else if (txHash) {
                try {
                    const receipt = await chainProvider.getTransactionReceipt(txHash);
                    if (receipt) {
                        blockNumber = receipt.blockNumber;
                        const block = await chainProvider.getBlock(blockNumber);
                        blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
                    }
                }
                catch {
                    // Could not get block from receipt - use current time
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
            await (0, handler_1.saveTradeEvent)(eventData, priceData);
        }
        catch (err) {
            console.error('❌ Error handling TokenSold event:', err);
        }
    });
    // TokenCreated event - ethers.js v6 format
    ws_contract.on('TokenCreated', async (...args) => {
        try {
            // Extract event arguments
            // TokenCreated event signature from contract:
            // event TokenCreated(address indexed tokenAddress, address indexed creator, string name, string symbol, string description, string uri, uint256 totalSupply, uint256 virtualEthReserves, uint256 virtualTokenReserves, uint256 graduationEth)
            // args[0]: tokenAddress, args[1]: creator, args[2]: name, args[3]: symbol, args[4]: description, args[5]: uri,
            // args[6]: totalSupply, args[7]: virtualEthReserves, args[8]: virtualTokenReserves, args[9]: graduationEth
            // args[10]: eventLog object (added by ethers.js)
            const tokenAddress = args[0];
            const creator = args[1];
            const name = args[2];
            const symbol = args[3];
            const description = args[4];
            const uri = args[5];
            const totalSupply = args[6];
            const virtualEthReserves = args[7];
            const virtualTokenReserves = args[8];
            const graduationEth = args[9];
            const eventLog = args[10]; // The event log object is at index 10
            if (!tokenAddress) {
                console.error('❌ TokenCreated event missing tokenAddress');
                return;
            }
            let txHash = undefined;
            let blockNumber = undefined;
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
                        const latestEvent = events.find((e) => e.args && e.args[0]?.toLowerCase() === tokenAddress.toLowerCase());
                        if (latestEvent) {
                            if (!txHash && latestEvent.log?.transactionHash)
                                txHash = latestEvent.log.transactionHash;
                            if (!txHash && latestEvent.transactionHash)
                                txHash = latestEvent.transactionHash;
                            if (!blockNumber && latestEvent.log?.blockNumber)
                                blockNumber = latestEvent.log.blockNumber;
                            if (!blockNumber && latestEvent.blockNumber)
                                blockNumber = latestEvent.blockNumber;
                        }
                    }
                }
                catch {
                    // Could not get from queryFilter - continue with other methods
                }
            }
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
                }
                catch {
                    // Could not get block timestamp - use current time
                }
            }
            else if (txHash) {
                try {
                    const receipt = await chainProvider.getTransactionReceipt(txHash);
                    if (receipt) {
                        blockNumber = receipt.blockNumber;
                        const block = await chainProvider.getBlock(blockNumber);
                        blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
                    }
                }
                catch {
                    // Could not get block from receipt - use current time
                }
            }
            const priceData = {
                tokenAddress: tokenAddress,
                tokenPrice: calculatePrice(virtualEthReserves, virtualTokenReserves),
                blockNumber: blockNumber || 0,
                timestamp: blockTimestamp,
                chainId: chainId,
            };
            await (0, handler_1.saveCreatedEvent)(eventData, priceData);
        }
        catch (err) {
            console.error('❌ Error handling TokenCreated event:', err);
        }
    });
    // TokenGraduated event - ethers.js v6 format
    ws_contract.on('TokenGraduated', async (...args) => {
        try {
            // TokenGraduated event: event TokenGraduated(address indexed tokenAddress, uint256 graduationPrice)
            const tokenAddress = args[0];
            const graduationPrice = args[1];
            const eventLog = args[args.length - 1];
            // Extract txHash and blockNumber from event log
            let txHash = undefined;
            let blockNumber = undefined;
            if (eventLog && typeof eventLog === 'object') {
                if (eventLog.log && eventLog.log.transactionHash) {
                    txHash = eventLog.log.transactionHash;
                    blockNumber = eventLog.log.blockNumber;
                }
                else if (eventLog.transactionHash) {
                    txHash = eventLog.transactionHash;
                    blockNumber = eventLog.blockNumber;
                }
                else if (eventLog.hash) {
                    txHash = eventLog.hash;
                }
            }
            // Fallback: Use queryFilter to get the event
            if (!txHash) {
                try {
                    const filter = ws_contract.filters.TokenGraduated(tokenAddress);
                    const events = await ws_contract.queryFilter(filter, 'latest', 'latest');
                    if (events && events.length > 0) {
                        const latestEvent = events[events.length - 1];
                        if (latestEvent && 'log' in latestEvent) {
                            const eventLog = latestEvent.log;
                            if (eventLog && eventLog.transactionHash) {
                                txHash = eventLog.transactionHash;
                                blockNumber = eventLog.blockNumber;
                            }
                        }
                        else if (latestEvent && 'transactionHash' in latestEvent) {
                            // Fallback: event might have transactionHash directly
                            txHash = latestEvent.transactionHash;
                            blockNumber = latestEvent.blockNumber;
                        }
                    }
                }
                catch {
                    // Could not get from queryFilter - continue with other methods
                }
            }
            // Final fallback: Get from transaction receipt if we have txHash
            if (txHash && !blockNumber) {
                try {
                    const receipt = await chainProvider.getTransactionReceipt(txHash);
                    if (receipt) {
                        blockNumber = receipt.blockNumber;
                    }
                }
                catch {
                    // Could not get block from receipt - continue
                }
            }
            if (!txHash) {
                console.error('❌ TokenGraduated event missing txHash after all extraction attempts');
                return;
            }
            // Get block timestamp
            let blockTimestamp = new Date();
            if (blockNumber) {
                try {
                    const block = await chainProvider.getBlock(blockNumber);
                    blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
                }
                catch {
                    // Could not get block timestamp - use current time
                }
            }
            else if (txHash) {
                try {
                    const receipt = await chainProvider.getTransactionReceipt(txHash);
                    if (receipt) {
                        blockNumber = receipt.blockNumber;
                        const block = await chainProvider.getBlock(blockNumber);
                        blockTimestamp = block?.timestamp ? new Date(block.timestamp * 1000) : new Date();
                    }
                }
                catch {
                    // Could not get block from receipt - use current time
                }
            }
            const eventData = {
                txHash: txHash,
                tokenAddress: tokenAddress,
                graduationPrice: graduationPrice.toString(),
                ethAmount: '0', // Will be updated if we track LiquidityAdded event
                tokenAmount: '0', // Will be updated if we track LiquidityAdded event
                blockNumber: blockNumber || 0,
                blockTimestamp: blockTimestamp,
                chainId: chainId,
            };
            await (0, handler_1.saveGraduationEvent)(eventData);
        }
        catch (err) {
            console.error('❌ Error handling TokenGraduated event:', err);
        }
    });
    // Add error handlers for WebSocket connection
    if (wsProvider && 'on' in wsProvider) {
        // Handle WebSocket provider errors (supported event)
        try {
            wsProvider.on('error', (error) => {
                console.error(`❌ WebSocket provider error for chain ${chainId}:`, error);
                console.error('   Error details:', error.message || error);
            });
        }
        catch {
            // Could not attach error handler - non-critical
        }
        // Monitor connection health by checking the underlying WebSocket
        if (wsProvider.websocket) {
            const underlyingWs = wsProvider.websocket; // WebSocketLike might not have all EventEmitter methods
            if (underlyingWs && typeof underlyingWs.on === 'function') {
                underlyingWs.on('error', (error) => {
                    console.error(`❌ Underlying WebSocket error for chain ${chainId}:`, error);
                });
                underlyingWs.on('close', (code) => {
                    // Remove from active tracking
                    activeTracking.delete(chainId);
                    // Attempt to reconnect (only if not a normal closure)
                    if (code !== 1000) { // 1000 = normal closure (don't reconnect)
                        reconnectWebSocket(chainId, 0);
                    }
                });
            }
        }
    }
};
/**
 * Track events for all configured chains
 */
const trackTrading = () => {
    const configuredChains = (0, blockchain_1.getConfiguredChains)();
    if (configuredChains.length === 0) {
        return;
    }
    // Track events for each configured chain
    for (const chainId of configuredChains) {
        try {
            trackChain(chainId);
        }
        catch (error) {
            console.error(`❌ Failed to initialize tracking for chain ${chainId}:`, error.message);
        }
    }
};
exports.trackTrading = trackTrading;
//# sourceMappingURL=track.js.map