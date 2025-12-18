export declare const recalculatePercentages: (tokenAddress: string, totalSupply: string, chainId: number) => Promise<void>;
export declare const saveTradeEvent: (eventData: any, priceData: any) => Promise<void>;
export declare const saveCreatedEvent: (eventData: any, priceData: any) => Promise<void>;
export declare const syncBlockRange: (start: number, end: number, chainId: number) => Promise<void>;
/**
 * Save TokenGraduated event as a LiquidityEvent record
 */
export declare const saveGraduationEvent: (eventData: any) => Promise<void>;
//# sourceMappingURL=handler.d.ts.map