export declare const validateAddress: (value: string) => boolean;
export declare const validateTxHash: (value: string) => boolean;
export declare const validateChainId: (value: string | number) => boolean;
export declare const validateAmount: (value: string) => boolean;
export declare const validateURL: (value: string) => boolean;
export declare const validateEmail: (value: string) => boolean;
export declare const validateUsername: (value: string) => boolean;
export declare const validatePassword: (value: string) => boolean;
export declare const validatePagination: (page: string | number, pageSize: string | number) => boolean;
export declare const validateSort: (sortBy: string, sortOrder: string) => boolean;
export declare const validateDateRange: (startDate: string, endDate: string) => boolean;
export declare const validateTokenMetadata: (metadata: {
    name?: string;
    symbol?: string;
    description?: string;
}) => boolean;
export declare const validateSocialLinks: (links: Record<string, string>) => boolean;
export declare const sanitizeInput: (data: any) => any;
export declare const validateAndSanitizeAddress: (address: string) => string | null;
export declare const validateNumericString: (value: string) => boolean;
export declare const validateBooleanString: (value: string) => boolean;
export declare const validateStringArray: (value: any) => boolean;
//# sourceMappingURL=validation.d.ts.map