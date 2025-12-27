"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ws_contract = exports.ws_provider = exports.contract = exports.contractAddress = exports.provider = exports.wsProviderCache = exports.wsConnectionAttempts = void 0;
exports.getWsUrl = getWsUrl;
exports.getProvider = getProvider;
exports.getFactoryAddressForChain = getFactoryAddressForChain;
exports.getContract = getContract;
exports.getWsProvider = getWsProvider;
exports.getWsContract = getWsContract;
exports.getConfiguredChains = getConfiguredChains;
exports.getOwnerSigner = getOwnerSigner;
exports.getContractWithSigner = getContractWithSigner;
const ethers_1 = require("ethers");
const TokenFactory_json_1 = __importDefault(require("./abi/TokenFactory.json"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Helper function to get chain name
function getChainName(chainId) {
    const names = {
        1: 'ETHEREUM',
        8453: 'BASE',
        42161: 'ARBITRUM',
        84532: 'BASE_SEPOLIA',
    };
    return names[chainId] || 'BASE_SEPOLIA';
}
// Helper function to get RPC URL for chain
function getRpcUrl(chainId) {
    const urls = {
        1: process.env.ETHEREUM_RPC_URL,
        8453: process.env.BASE_RPC_URL,
        42161: process.env.ARBITRUM_RPC_URL,
        84532: process.env.BASE_SEPOLIA_RPC_URL,
    };
    return urls[chainId]?.trim();
}
// Helper function to get factory address for chain
function getFactoryAddress(chainId) {
    const chainName = getChainName(chainId);
    return process.env[`FACTORY_ADDRESS_${chainName}`]?.trim();
}
// Helper function to get WebSocket URL for chain
function getWsUrl(chainId) {
    const urls = {
        1: process.env.ETHEREUM_WS_URL,
        8453: process.env.BASE_WS_URL,
        42161: process.env.ARBITRUM_WS_URL,
        84532: process.env.BASE_SEPOLIA_WS_URL,
    };
    return urls[chainId]?.trim();
}
/**
 * Create provider dynamically for a given chainId
 * With staticNetwork option to prevent network detection errors and timeouts
 */
function getProvider(chainId) {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
        throw new Error(`RPC URL not configured for chain ${chainId} (${getChainName(chainId)})`);
    }
    // Create provider with staticNetwork to prevent network detection
    // This avoids "failed to detect network" errors and timeouts
    // staticNetwork: true skips the eth_chainId call during initialization
    const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl, chainId, {
        staticNetwork: true, // Skip network detection (prevents "failed to detect network" errors)
        batchMaxCount: 1, // Disable batching to avoid issues with rate limits
    });
    return provider;
}
/**
 * Get factory address for a given chainId
 */
function getFactoryAddressForChain(chainId) {
    const factoryAddress = getFactoryAddress(chainId);
    if (!factoryAddress) {
        throw new Error(`Factory address not configured for chain ${chainId} (${getChainName(chainId)})`);
    }
    return factoryAddress;
}
/**
 * Create contract instance dynamically for a given chainId
 */
function getContract(chainId) {
    const provider = getProvider(chainId);
    const factoryAddress = getFactoryAddressForChain(chainId);
    return new ethers_1.ethers.Contract(factoryAddress, TokenFactory_json_1.default, provider);
}
// Cache WebSocket providers to prevent multiple connections for the same chain
const wsProviderCache = new Map();
exports.wsProviderCache = wsProviderCache;
const wsConnectionAttempts = new Map();
exports.wsConnectionAttempts = wsConnectionAttempts;
// WebSocket connection backoff configuration
const WS_CONNECTION_BACKOFF_BASE = 180000; // 5 seconds
const WS_CONNECTION_BACKOFF_MAX = 3600000; // 5 minutes max
/**
 * Create WebSocket provider dynamically for a given chainId
 * Caches providers to prevent multiple connections
 */
function getWsProvider(chainId) {
    // Enable diagnostic logging for all chains to debug provider creation
    const isDebugChain = true; // Log all chains, not just chain 1
    // Always log entry for all chains
    console.log(`🔍 DEBUG getWsProvider ENTRY for chain ${chainId}`);
    // Check if we should back off from previous 429 errors
    const attemptInfo = wsConnectionAttempts.get(chainId);
    if (attemptInfo) {
        const now = Date.now();
        if (now < attemptInfo.backoffUntil) {
            const waitTime = Math.ceil((attemptInfo.backoffUntil - now) / 1000);
            if (isDebugChain) {
                console.log(`🔍 DEBUG: Chain ${chainId} RETURNING NULL - IN BACKOFF (wait ${waitTime}s)`, {
                    chainId,
                    backoffUntil: new Date(attemptInfo.backoffUntil).toISOString(),
                    now: new Date(now).toISOString(),
                    waitTime
                });
            }
            if (waitTime > 10) {
                console.warn(`⚠️ WebSocket connection to chain ${chainId} is in backoff. Waiting ${waitTime}s before retry`);
            }
            return null; // RETURN POINT 1: Backoff active
        }
        // REMOVED: Rate limit check (line 127-129)
        // Reason: This was blocking legitimate connection attempts even when:
        // 1. Backoff has expired (connection should be allowed)
        // 2. Previous attempt was successful (cached provider handles reuse)
        // 3. No recent failures (backoff already handles failures)
        // 
        // The rate limit was too aggressive (60 seconds) and prevented:
        // - Initial connections on server startup
        // - Reconnections after successful connections
        // - Multiple chains from connecting simultaneously
        //
        // Backoff already provides sufficient protection for failures,
        // and cached provider check handles successful connection reuse.
    }
    // Return cached provider if exists and still connected
    const cached = wsProviderCache.get(chainId);
    if (cached) {
        try {
            // Check if the underlying WebSocket is still open
            const underlyingWs = cached.websocket || cached._websocket;
            if (underlyingWs) {
                const readyState = underlyingWs.readyState;
                // WebSocket readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
                if (readyState === 1) { // OPEN - reuse it
                    // Log when returning cached provider
                    console.log(`✅ Chain ${chainId} RETURNING CACHED PROVIDER - REUSING (readyState: OPEN)`);
                    return cached; // RETURN POINT: Cached provider (reused)
                }
                // If not open, remove from cache and create new one
                wsProviderCache.delete(chainId);
                // Only try to destroy if WebSocket is in OPEN or CLOSING state
                // Don't destroy if CONNECTING (0) - it will throw "WebSocket was closed before the connection was established"
                // Don't destroy if CLOSED (3) - it's already closed
                if (readyState === 1 || readyState === 2) { // OPEN or CLOSING
                    try {
                        cached.destroy();
                    }
                    catch (destroyErr) {
                        // Ignore destroy errors - WebSocket might already be closed or in an invalid state
                    }
                }
                else {
                    // For CONNECTING (0) or CLOSED (3), just remove from cache without destroying
                }
            }
            else {
                // No underlying WebSocket found, just remove from cache
                wsProviderCache.delete(chainId);
            }
        }
        catch (err) {
            // If we can't check status, assume it's dead and create new one
            wsProviderCache.delete(chainId);
        }
    }
    const wsUrl = getWsUrl(chainId);
    if (!wsUrl) {
        if (isDebugChain) {
            console.log(`🔍 DEBUG: Chain ${chainId} RETURNING NULL - NO URL`, {
                chainId,
                envVar: chainId === 1 ? 'ETHEREUM_WS_URL' :
                    chainId === 8453 ? 'BASE_WS_URL' :
                        chainId === 42161 ? 'ARBITRUM_WS_URL' :
                            chainId === 84532 ? 'BASE_SEPOLIA_WS_URL' : 'UNKNOWN',
                envValue: process.env[chainId === 1 ? 'ETHEREUM_WS_URL' :
                    chainId === 8453 ? 'BASE_WS_URL' :
                        chainId === 42161 ? 'ARBITRUM_WS_URL' :
                            chainId === 84532 ? 'BASE_SEPOLIA_WS_URL' : ''] || 'NOT SET',
                envValueLength: process.env[chainId === 1 ? 'ETHEREUM_WS_URL' :
                    chainId === 8453 ? 'BASE_WS_URL' :
                        chainId === 42161 ? 'ARBITRUM_WS_URL' :
                            chainId === 84532 ? 'BASE_SEPOLIA_WS_URL' : '']?.length
            });
        }
        return null; // RETURN POINT 3: No URL configured
    }
    try {
        // Update attempt tracking before attempting connection
        const now = Date.now();
        const attemptCount = attemptInfo ? attemptInfo.count + 1 : 1;
        wsConnectionAttempts.set(chainId, {
            count: attemptCount,
            lastAttempt: now,
            backoffUntil: 0 // Will be set if 429 occurs
        });
        if (isDebugChain) {
            console.log(`🔍 DEBUG: About to create WebSocket provider for chain ${chainId}`, {
                chainId,
                wsUrl: wsUrl.substring(0, 50) + '...',
                wsUrlLength: wsUrl.length,
                hasAttemptInfo: !!attemptInfo,
                attemptCount: attemptInfo?.count || 0
            });
        }
        const provider = new ethers_1.ethers.WebSocketProvider(wsUrl, chainId // Pass chainId as number
        );
        if (isDebugChain) {
            console.log(`✅ WebSocket provider object created for chain ${chainId}`, {
                chainId,
                providerType: provider.constructor.name,
                hasProvider: !!provider
            });
        }
        // Cache the provider
        wsProviderCache.set(chainId, provider);
        // Handle connection errors (including 429) and cleanup
        const underlyingWs = provider.websocket || provider._websocket;
        if (isDebugChain) {
            console.log(`🔍 DEBUG: Underlying WebSocket check for chain ${chainId}`, {
                chainId,
                hasUnderlyingWs: !!underlyingWs,
                underlyingWsType: underlyingWs ? typeof underlyingWs : 'undefined',
                readyState: underlyingWs?.readyState,
                readyStateName: underlyingWs ? (underlyingWs.readyState === 0 ? 'CONNECTING' :
                    underlyingWs.readyState === 1 ? 'OPEN' :
                        underlyingWs.readyState === 2 ? 'CLOSING' :
                            underlyingWs.readyState === 3 ? 'CLOSED' : 'UNKNOWN') : 'N/A'
            });
        }
        if (underlyingWs) {
            underlyingWs.on('close', (code) => {
                wsProviderCache.delete(chainId);
                // Reset backoff on successful close (connection was established, then closed normally)
                // Only reset if it was a normal closure (code 1000) or if connection was established
                if (code === 1000) {
                    wsConnectionAttempts.delete(chainId);
                }
            });
            // Handle error events including 429 rate limiting
            underlyingWs.on('error', (error) => {
                // Check if it's a 429 error
                const errorMessage = error?.message || String(error);
                if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
                    const currentAttempt = wsConnectionAttempts.get(chainId) || { count: 0, lastAttempt: 0, backoffUntil: 0 };
                    const backoffTime = Math.min(WS_CONNECTION_BACKOFF_BASE * Math.pow(2, Math.min(currentAttempt.count, 6)), WS_CONNECTION_BACKOFF_MAX);
                    const backoffUntil = Date.now() + backoffTime;
                    wsConnectionAttempts.set(chainId, {
                        count: currentAttempt.count + 1,
                        lastAttempt: Date.now(),
                        backoffUntil
                    });
                    console.error(`❌ WebSocket connection rate limited (429) for chain ${chainId}. Backing off for ${Math.ceil(backoffTime / 1000)}s (attempt ${currentAttempt.count + 1})`);
                    wsProviderCache.delete(chainId);
                }
                else {
                    // For non-429 errors, just clean up cache
                    wsProviderCache.delete(chainId);
                }
            });
        }
        else {
            if (isDebugChain) {
                console.warn(`⚠️ Underlying WebSocket not available immediately for chain ${chainId} - provider still returned, connection happens asynchronously`);
            }
        }
        // Always log success for all chains (not just debug chains)
        console.log(`✅ Chain ${chainId} RETURNING PROVIDER - SUCCESS (newly created)`);
        return provider; // RETURN POINT 4: Success
    }
    catch (error) {
        // Enhanced error logging - log ALL errors, not just 429
        const errorMessage = error?.message || String(error);
        if (isDebugChain) {
            console.log(`🔍 DEBUG: Chain ${chainId} RETURNING NULL - ERROR`, {
                chainId,
                error: errorMessage,
                errorName: error.name,
                errorCode: error.code,
                errorType: error.constructor.name,
                stack: error.stack?.substring(0, 200)
            });
        }
        console.error(`❌ ERROR creating WebSocket provider for chain ${chainId}`, {
            chainId,
            error: errorMessage,
            errorName: error.name,
            errorCode: error.code,
            url: wsUrl.substring(0, 50) + '...',
            errorType: error.constructor.name
        });
        // Handle 429 in catch block too (in case error happens during construction)
        if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
            const currentAttempt = wsConnectionAttempts.get(chainId) || { count: 0, lastAttempt: 0, backoffUntil: 0 };
            const backoffTime = Math.min(WS_CONNECTION_BACKOFF_BASE * Math.pow(2, Math.min(currentAttempt.count, 6)), WS_CONNECTION_BACKOFF_MAX);
            wsConnectionAttempts.set(chainId, {
                count: currentAttempt.count + 1,
                lastAttempt: Date.now(),
                backoffUntil: Date.now() + backoffTime
            });
            console.error(`❌ WebSocket connection rate limited (429) for chain ${chainId} during creation. Backing off for ${Math.ceil(backoffTime / 1000)}s (attempt ${currentAttempt.count + 1})`);
        }
        else {
            // Log non-429 errors too
            console.error(`❌ Non-429 error creating WebSocket provider for chain ${chainId}:`, errorMessage);
        }
        return null; // RETURN POINT 5: Error during creation
    }
}
/**
 * Create WebSocket contract instance dynamically for a given chainId
 */
function getWsContract(chainId) {
    const wsProvider = getWsProvider(chainId);
    if (!wsProvider) {
        return null;
    }
    try {
        const factoryAddress = getFactoryAddressForChain(chainId);
        return new ethers_1.ethers.Contract(factoryAddress, TokenFactory_json_1.default, wsProvider);
    }
    catch (error) {
        return null;
    }
}
/**
 * Get all configured chains (chains that have both RPC URL and Factory Address)
 */
function getConfiguredChains() {
    const supportedChains = [1, 8453, 42161, 84532]; // Ethereum, Base, Arbitrum, Base Sepolia
    const configuredChains = [];
    for (const chainId of supportedChains) {
        const rpcUrl = getRpcUrl(chainId);
        const factoryAddress = getFactoryAddress(chainId);
        if (rpcUrl && factoryAddress) {
            configuredChains.push(chainId);
        }
    }
    return configuredChains;
}
/**
 * Get owner signer for a given chainId (for admin functions like graduateTokenManually)
 * Uses chain-specific private key: OWNER_PRIVATE_KEY_{CHAIN_NAME} or fallback to OWNER_PRIVATE_KEY
 */
function getOwnerSigner(chainId) {
    const chainName = getChainName(chainId);
    const privateKey = process.env[`OWNER_PRIVATE_KEY_${chainName}`] || process.env.OWNER_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error(`Owner private key not configured for chain ${chainId} (${chainName}). ` +
            `Set OWNER_PRIVATE_KEY_${chainName} or OWNER_PRIVATE_KEY in environment variables.`);
    }
    const provider = getProvider(chainId);
    return new ethers_1.ethers.Wallet(privateKey, provider);
}
/**
 * Get contract instance with owner signer for a given chainId
 * Used for calling admin functions like graduateTokenManually
 */
function getContractWithSigner(chainId) {
    const signer = getOwnerSigner(chainId);
    const factoryAddress = getFactoryAddressForChain(chainId);
    return new ethers_1.ethers.Contract(factoryAddress, TokenFactory_json_1.default, signer);
}
// Default chainId for backward compatibility (uses CHAIN_ID env var or Base Sepolia)
const defaultChainId = parseInt(process.env.CHAIN_ID || '84532');
const defaultRpcUrl = getRpcUrl(defaultChainId);
const defaultFactoryAddress = getFactoryAddress(defaultChainId);
if (!defaultRpcUrl || !defaultFactoryAddress) {
    console.error(`Error: Missing environment variables for default chain ${defaultChainId} (${getChainName(defaultChainId)}).`);
    console.error(`Required: ${getChainName(defaultChainId)}_RPC_URL and FACTORY_ADDRESS_${getChainName(defaultChainId)}`);
    process.exit(1);
}
// Default exports for backward compatibility
exports.provider = getProvider(defaultChainId);
exports.contractAddress = defaultFactoryAddress;
exports.contract = new ethers_1.ethers.Contract(defaultFactoryAddress, TokenFactory_json_1.default, exports.provider);
// Default WebSocket provider (optional)
const defaultWsUrl = getWsUrl(defaultChainId);
let ws_provider = null;
exports.ws_provider = ws_provider;
let ws_contract = null;
exports.ws_contract = ws_contract;
if (defaultWsUrl) {
    try {
        exports.ws_provider = ws_provider = getWsProvider(defaultChainId);
        if (ws_provider) {
            exports.ws_contract = ws_contract = new ethers_1.ethers.Contract(defaultFactoryAddress, TokenFactory_json_1.default, ws_provider);
        }
    }
    catch (error) {
    }
}
//# sourceMappingURL=blockchain.js.map