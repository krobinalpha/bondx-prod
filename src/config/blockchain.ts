import { ethers } from 'ethers';
import FactoryABI from './abi/TokenFactory.json';
import dotenv from 'dotenv';

dotenv.config();

// Helper function to get chain name
function getChainName(chainId: number): string {
  const names: Record<number, string> = {
    1: 'ETHEREUM',
    8453: 'BASE',
    42161: 'ARBITRUM',
    84532: 'BASE_SEPOLIA',
  };
  return names[chainId] || 'BASE_SEPOLIA';
}

// Helper function to get RPC URL for chain
function getRpcUrl(chainId: number): string | undefined {
  const urls: Record<number, string | undefined> = {
    1: process.env.ETHEREUM_RPC_URL,
    8453: process.env.BASE_RPC_URL,
    42161: process.env.ARBITRUM_RPC_URL,
    84532: process.env.BASE_SEPOLIA_RPC_URL,
  };
  return urls[chainId]?.trim();
}

// Helper function to get factory address for chain
function getFactoryAddress(chainId: number): string | undefined {
  const chainName = getChainName(chainId);
  return process.env[`FACTORY_ADDRESS_${chainName}`]?.trim();
}

// Helper function to get WebSocket URL for chain
function getWsUrl(chainId: number): string | undefined {
  const urls: Record<number, string | undefined> = {
    1: process.env.ETHEREUM_WS_URL,
    8453: process.env.BASE_WS_URL,
    42161: process.env.ARBITRUM_WS_URL,
    84532: process.env.BASE_SEPOLIA_WS_URL,
  };
  return urls[chainId]?.trim();
}

/**
 * Create provider dynamically for a given chainId
 */
export function getProvider(chainId: number): ethers.JsonRpcProvider {
  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    throw new Error(`RPC URL not configured for chain ${chainId} (${getChainName(chainId)})`);
  }
  
  // Pass chainId as number - ethers.js v6 will use it to avoid network detection
  // The third parameter options are not needed when passing chainId directly
  return new ethers.JsonRpcProvider(rpcUrl, chainId);
}

/**
 * Get factory address for a given chainId
 */
export function getFactoryAddressForChain(chainId: number): string {
  const factoryAddress = getFactoryAddress(chainId);
  if (!factoryAddress) {
    throw new Error(`Factory address not configured for chain ${chainId} (${getChainName(chainId)})`);
  }
  return factoryAddress;
}

/**
 * Create contract instance dynamically for a given chainId
 */
export function getContract(chainId: number): ethers.Contract {
  const provider = getProvider(chainId);
  const factoryAddress = getFactoryAddressForChain(chainId);
  return new ethers.Contract(factoryAddress, FactoryABI, provider);
}

// Cache WebSocket providers to prevent multiple connections for the same chain
const wsProviderCache = new Map<number, ethers.WebSocketProvider>();

/**
 * Create WebSocket provider dynamically for a given chainId
 * Caches providers to prevent multiple connections
 */
export function getWsProvider(chainId: number): ethers.WebSocketProvider | null {
  // Return cached provider if exists and still connected
  const cached = wsProviderCache.get(chainId);
  if (cached) {
    try {
      // Check if the underlying WebSocket is still open
      const underlyingWs = (cached as any).websocket || (cached as any)._websocket;
      if (underlyingWs) {
        const readyState = underlyingWs.readyState;
        // WebSocket readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
        if (readyState === 1) { // OPEN - reuse it
          return cached;
        }
        // If not open, remove from cache and create new one
        console.log(`🔄 Cached WebSocket for chain ${chainId} is not open (state: ${readyState}). Creating new connection...`);
        wsProviderCache.delete(chainId);
        
        // Only try to destroy if WebSocket is in OPEN or CLOSING state
        // Don't destroy if CONNECTING (0) - it will throw "WebSocket was closed before the connection was established"
        // Don't destroy if CLOSED (3) - it's already closed
        if (readyState === 1 || readyState === 2) { // OPEN or CLOSING
          try {
            cached.destroy();
          } catch (destroyErr: any) {
            // Ignore destroy errors - WebSocket might already be closed or in an invalid state
            console.log(`ℹ️ Could not destroy cached provider for chain ${chainId} (state: ${readyState}):`, destroyErr.message);
          }
        } else {
          // For CONNECTING (0) or CLOSED (3), just remove from cache without destroying
          console.log(`ℹ️ Skipping destroy for chain ${chainId} (WebSocket state: ${readyState} - CONNECTING or CLOSED)`);
        }
      } else {
        // No underlying WebSocket found, just remove from cache
        console.log(`🔄 Cached provider for chain ${chainId} has no underlying WebSocket. Creating new connection...`);
        wsProviderCache.delete(chainId);
      }
    } catch (err) {
      // If we can't check status, assume it's dead and create new one
      console.warn(`⚠️ Error checking cached provider for chain ${chainId}:`, err);
      wsProviderCache.delete(chainId);
    }
  }
  
  const wsUrl = getWsUrl(chainId);
  if (!wsUrl) {
    return null;
  }
  
  try {
    const provider = new ethers.WebSocketProvider(
      wsUrl,
      chainId // Pass chainId as number
    );
    
    // Cache the provider
    wsProviderCache.set(chainId, provider);
    
    // Clean up cache entry if connection closes or errors
    const underlyingWs = (provider as any).websocket || (provider as any)._websocket;
    if (underlyingWs) {
      underlyingWs.on('close', () => {
        wsProviderCache.delete(chainId);
      });
      
      // Also handle error events to clean up cache
      underlyingWs.on('error', (error: any) => {
        console.warn(`⚠️ WebSocket error for chain ${chainId}, removing from cache:`, error.message || error);
        wsProviderCache.delete(chainId);
      });
    }
    
    return provider;
  } catch (error) {
    console.warn(`⚠️ WebSocket provider initialization failed for chain ${chainId}:`, error);
    return null;
  }
}

/**
 * Create WebSocket contract instance dynamically for a given chainId
 */
export function getWsContract(chainId: number): ethers.Contract | null {
  const wsProvider = getWsProvider(chainId);
  if (!wsProvider) {
    return null;
  }
  
  try {
    const factoryAddress = getFactoryAddressForChain(chainId);
    return new ethers.Contract(factoryAddress, FactoryABI, wsProvider);
  } catch (error) {
    console.warn(`⚠️ WebSocket contract initialization failed for chain ${chainId}:`, error);
    return null;
  }
}

/**
 * Get all configured chains (chains that have both RPC URL and Factory Address)
 */
export function getConfiguredChains(): number[] {
  const supportedChains = [1, 8453, 42161, 84532]; // Ethereum, Base, Arbitrum, Base Sepolia
  const configuredChains: number[] = [];
  
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
export function getOwnerSigner(chainId: number): ethers.Wallet {
  const chainName = getChainName(chainId);
  const privateKey = process.env[`OWNER_PRIVATE_KEY_${chainName}`] || process.env.OWNER_PRIVATE_KEY;
  
  if (!privateKey) {
    throw new Error(
      `Owner private key not configured for chain ${chainId} (${chainName}). ` +
      `Set OWNER_PRIVATE_KEY_${chainName} or OWNER_PRIVATE_KEY in environment variables.`
    );
  }
  
  const provider = getProvider(chainId);
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Get contract instance with owner signer for a given chainId
 * Used for calling admin functions like graduateTokenManually
 */
export function getContractWithSigner(chainId: number): ethers.Contract {
  const signer = getOwnerSigner(chainId);
  const factoryAddress = getFactoryAddressForChain(chainId);
  return new ethers.Contract(factoryAddress, FactoryABI, signer);
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
export const provider = getProvider(defaultChainId);
export const contractAddress = defaultFactoryAddress;
export const contract = new ethers.Contract(defaultFactoryAddress, FactoryABI, provider);

// Default WebSocket provider (optional)
const defaultWsUrl = getWsUrl(defaultChainId);
let ws_provider: ethers.WebSocketProvider | null = null;
let ws_contract: ethers.Contract | null = null;

if (defaultWsUrl) {
  try {
    ws_provider = getWsProvider(defaultChainId);
    if (ws_provider) {
      ws_contract = new ethers.Contract(defaultFactoryAddress, FactoryABI, ws_provider);
      console.log(`✅ Default WebSocket provider initialized for chain ${defaultChainId}`);
    }
  } catch (error) {
    console.warn('⚠️ Default WebSocket provider initialization failed:', error);
  }
}

console.log(`✅ Default contract initialized at address: ${contractAddress} on chain ${defaultChainId} (${getChainName(defaultChainId)})`);

export { ws_provider, ws_contract };
