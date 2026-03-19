import { spawn, ChildProcess } from 'node:child_process';
import { Logger } from './logger.js';

const log = new Logger('server-manager');

const SERVER_READY_PATTERN = 'opencode server listening';

export interface ServerManagerOptions {
  port: number;
  hostname?: string;
  startupTimeoutMs?: number;
}

export class ServerManager {
  private process: ChildProcess | null = null;
  private port: number;
  private hostname: string;
  private startupTimeoutMs: number;
  private ready = false;
  private externalServer = false;

  constructor(options: ServerManagerOptions) {
    this.port = options.port;
    this.hostname = options.hostname ?? '127.0.0.1';
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30000;
  }

  get baseUrl(): string {
    return `http://${this.hostname}:${this.port}`;
  }

  get isRunning(): boolean {
    return this.ready && (this.externalServer || (this.process !== null && this.process.exitCode === null));
  }

  private async checkExistingServer(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      log.debug('Server already running');
      return;
    }

    // Check if an external server is already running on this port
    const existingServer = await this.checkExistingServer();
    if (existingServer) {
      log.info('Using existing opencode server', { port: this.port, hostname: this.hostname });
      this.ready = true;
      this.externalServer = true;
      return;
    }

    log.info('Starting opencode server', { port: this.port, hostname: this.hostname });

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let resolved = false;

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stop();
          reject(new Error(`opencode server failed to start within ${this.startupTimeoutMs}ms`));
        }
      }, this.startupTimeoutMs);

      const args = ['serve', '--port', String(this.port), '--hostname', this.hostname];
      const command = 'opencode';

      this.process = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: process.platform === 'win32',
      });

      log.debug('Spawned opencode server process', {
        command,
        args,
        shell: process.platform === 'win32',
      });

      const onData = (data: Buffer) => {
        const line = data.toString();
        log.debug('opencode output', { output: line.trim() });

        if (!resolved && line.includes(SERVER_READY_PATTERN)) {
          resolved = true;
          clearTimeout(timeoutId);
          this.ready = true;
          log.info('opencode server ready', { port: this.port, startupMs: Date.now() - startTime });
          resolve();
        }
      };

      this.process.stdout?.on('data', onData);
      this.process.stderr?.on('data', onData);

      this.process.on('error', (err) => {
        log.error('Failed to start opencode server', { error: err.message });
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(err);
        }
        this.ready = false;
      });

      this.process.on('exit', (code, signal) => {
        log.info('opencode server exited', { code, signal });
        this.ready = false;
        this.process = null;

        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(new Error(`opencode server exited during startup with code ${code}`));
        }
      });
    });
  }

  stop(): void {
    if (this.externalServer) {
      log.info('Not stopping external opencode server');
      this.ready = false;
      this.externalServer = false;
      return;
    }

    if (!this.process) return;

    log.info('Stopping opencode server');

    this.ready = false;

    try {
      this.process.kill('SIGTERM');
    } catch {
      try {
        this.process.kill('SIGKILL');
      } catch {}
    }

    this.process = null;
  }
}
