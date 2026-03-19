import { Logger, LogEntry } from './logger.js';

const MAX_LOG_LINES = 500;

let logBuffer: string[] = [];
let sseCallback: ((formatted: string) => void) | null = null;
let isInitialized = false;

export function initLogBuffer(): void {
  if (isInitialized) return;
  isInitialized = true;

  Logger.addCallback((_entry: LogEntry, formatted: string) => {
    logBuffer.push(formatted);

    if (logBuffer.length > MAX_LOG_LINES) {
      logBuffer.shift();
    }

    if (sseCallback) {
      sseCallback(formatted);
    }
  });
}

export function getLogs(): string[] {
  return [...logBuffer];
}

export function setLogStreamCallback(callback: (formatted: string) => void): void {
  sseCallback = callback;
}

export function clearLogStreamCallback(): void {
  sseCallback = null;
}
