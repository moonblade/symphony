import * as path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { Logger } from './logger.js';

const log = new Logger('file-watcher');

export interface FileWatcherOptions {
  root?: string;
  extensions?: string[];
  ignored?: string[];
  debounceMs?: number;
  onReload: (changedFile: string) => void;
}

const DEFAULT_OPTIONS = {
  extensions: ['.ts', '.md'],
  ignored: ['node_modules', 'dist', '.git', '*.db', '*.db-*'],
  debounceMs: 300,
};

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private root: string;
  private extensions: string[];
  private ignored: string[];
  private debounceMs: number;
  private onReload: (changedFile: string) => void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFile: string | null = null;

  constructor(options: FileWatcherOptions) {
    this.root = options.root ?? process.cwd();
    this.extensions = options.extensions ?? DEFAULT_OPTIONS.extensions;
    this.ignored = options.ignored ?? DEFAULT_OPTIONS.ignored;
    this.debounceMs = options.debounceMs ?? DEFAULT_OPTIONS.debounceMs;
    this.onReload = options.onReload;
  }

  start(): void {
    if (this.watcher) {
      log.warn('File watcher already started');
      return;
    }

    const watchPatterns = this.extensions.map(ext => 
      path.join(this.root, '**', `*${ext}`)
    );

    log.info('Starting file watcher', {
      root: this.root,
      extensions: this.extensions,
      patterns: watchPatterns,
    });

    this.watcher = watch(watchPatterns, {
      ignored: this.ignored.map(pattern => {
        if (pattern.includes('*')) {
          return pattern;
        }
        return new RegExp(`(^|[\\/\\\\])${pattern}([\\/\\\\]|$)`);
      }),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('change', (filePath) => this.handleChange(filePath, 'changed'));
    this.watcher.on('add', (filePath) => this.handleChange(filePath, 'added'));
    this.watcher.on('unlink', (filePath) => this.handleChange(filePath, 'removed'));

    this.watcher.on('ready', () => {
      log.info('File watcher ready');
    });

    this.watcher.on('error', (error) => {
      log.error('File watcher error', { error: (error as Error).message });
    });
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      log.info('File watcher stopped');
    }
  }

  private handleChange(filePath: string, event: string): void {
    const relativePath = path.relative(this.root, filePath);
    const ext = path.extname(filePath);

    if (!this.extensions.includes(ext)) {
      return;
    }

    log.debug('File change detected', { file: relativePath, event });

    this.pendingFile = relativePath;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const changedFile = this.pendingFile;
      this.pendingFile = null;
      this.debounceTimer = null;

      if (changedFile) {
        log.info('Triggering reload', { file: changedFile });
        this.onReload(changedFile);
      }
    }, this.debounceMs);
  }
}
