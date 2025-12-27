"use strict";
/**
 * Structured logging utility for activity monitoring
 * Replaces console.log with proper log levels
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
class Logger {
    constructor() {
        this.isDevelopment = process.env.NODE_ENV !== 'production';
    }
    formatMessage(level, message, data) {
        const timestamp = new Date().toISOString();
        const prefix = this.getPrefix(level);
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        return `${prefix} [${timestamp}] ${message}${dataStr}`;
    }
    getPrefix(level) {
        switch (level) {
            case 'debug':
                return '🔍 DEBUG';
            case 'info':
                return 'ℹ️  INFO';
            case 'warn':
                return '⚠️  WARN';
            case 'error':
                return '❌ ERROR';
            default:
                return '📝 LOG';
        }
    }
    shouldLog(level) {
        // In production, only log warn and error
        if (!this.isDevelopment) {
            return level === 'warn' || level === 'error';
        }
        return true;
    }
    debug(message, data) {
        if (this.shouldLog('debug')) {
            console.log(this.formatMessage('debug', message, data));
        }
    }
    info(message, data) {
        if (this.shouldLog('info')) {
            console.log(this.formatMessage('info', message, data));
        }
    }
    warn(message, data) {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message, data));
        }
    }
    error(message, error, data) {
        if (this.shouldLog('error')) {
            const errorData = { ...data };
            if (error instanceof Error) {
                errorData.error = {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                };
            }
            else if (error) {
                errorData.error = error;
            }
            console.error(this.formatMessage('error', message, errorData));
        }
    }
}
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map