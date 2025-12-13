import { ethers } from 'ethers';
/**
 * Create provider dynamically for a given chainId
 */
export declare function getProvider(chainId: number): ethers.JsonRpcProvider;
/**
 * Get factory address for a given chainId
 */
export declare function getFactoryAddressForChain(chainId: number): string;
/**
 * Create contract instance dynamically for a given chainId
 */
export declare function getContract(chainId: number): ethers.Contract;
/**
 * Create WebSocket provider dynamically for a given chainId
 */
export declare function getWsProvider(chainId: number): ethers.WebSocketProvider | null;
/**
 * Create WebSocket contract instance dynamically for a given chainId
 */
export declare function getWsContract(chainId: number): ethers.Contract | null;
/**
 * Get all configured chains (chains that have both RPC URL and Factory Address)
 */
export declare function getConfiguredChains(): number[];
export declare const provider: ethers.JsonRpcProvider;
export declare const contractAddress: string;
export declare const contract: ethers.Contract;
declare let ws_provider: ethers.WebSocketProvider | null;
declare let ws_contract: ethers.Contract | null;
export { ws_provider, ws_contract };
//# sourceMappingURL=blockchain.d.ts.map