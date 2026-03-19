export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  context?: Record<string, unknown>;
}

export type LogCallback = (entry: LogEntry, formatted: string) => void;

export class Logger {
  private static minLevel: LogLevel = 'info';
  private static callbacks: LogCallback[] = [];

  constructor(private component: string) {}

  static setLevel(level: LogLevel): void {
    Logger.minLevel = level;
  }

  static addCallback(callback: LogCallback): () => void {
    Logger.callbacks.push(callback);
    return () => {
      const idx = Logger.callbacks.indexOf(callback);
      if (idx !== -1) Logger.callbacks.splice(idx, 1);
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[Logger.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    const base = `[${entry.timestamp}] ${entry.level.toUpperCase().padEnd(5)} [${entry.component}] ${entry.message}`;
    if (entry.context && Object.keys(entry.context).length > 0) {
      return `${base} ${JSON.stringify(entry.context)}`;
    }
    return base;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      context,
    };

    const formatted = this.formatEntry(entry);

    for (const callback of Logger.callbacks) {
      callback(entry, formatted);
    }

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  child(subComponent: string): Logger {
    return new Logger(`${this.component}:${subComponent}`);
  }
}
