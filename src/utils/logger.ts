/**
 * Structured logging utility for activity monitoring
 * Replaces console.log with proper log levels
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  private formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const prefix = this.getPrefix(level);
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `${prefix} [${timestamp}] ${message}${dataStr}`;
  }

  private getPrefix(level: LogLevel): string {
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

  private shouldLog(level: LogLevel): boolean {
    // In production, only log warn and error
    if (!this.isDevelopment) {
      return level === 'warn' || level === 'error';
    }
    return true;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, data));
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, data));
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, data));
    }
  }

  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      const errorData: Record<string, unknown> = { ...data };
      
      if (error instanceof Error) {
        errorData.error = {
          message: error.message,
          stack: error.stack,
          name: error.name,
        };
      } else if (error) {
        errorData.error = error;
      }

      console.error(this.formatMessage('error', message, errorData));
    }
  }
}

export const logger = new Logger();

