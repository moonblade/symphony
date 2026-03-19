import { Logger } from './logger.js';

export interface LogContext {
  [key: string]: unknown;
}

const logger = new Logger('symphony');

export function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
  logger[level](message, context);
}

export function debug(message: string, context?: LogContext): void {
  log('debug', message, context);
}

export function info(message: string, context?: LogContext): void {
  log('info', message, context);
}

export function warn(message: string, context?: LogContext): void {
  log('warn', message, context);
}

export function error(message: string, context?: LogContext): void {
  log('error', message, context);
}

export { Logger };
