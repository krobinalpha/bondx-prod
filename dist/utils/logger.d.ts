/**
 * Structured logging utility for activity monitoring
 * Replaces console.log with proper log levels
 */
declare class Logger {
    private isDevelopment;
    constructor();
    private formatMessage;
    private getPrefix;
    private shouldLog;
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map