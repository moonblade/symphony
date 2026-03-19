import { spawn, ChildProcess } from 'node:child_process';
import {
  Platform,
  PlatformSession,
  PlatformEvent,
  PlatformEventType,
  CreateSessionOptions,
  ResumeSessionOptions,
  RunTurnOptions,
  TurnResult,
  PlatformConfig,
} from './types.js';
import { Logger } from '../logger.js';

const log = new Logger('copilot-platform');

interface CopilotConfig {
  token?: string;
  model?: string;
  allowAllTools?: boolean;
  allowAllPaths?: boolean;
  allowedTools?: string[];
  additionalDirs?: string[];
  silent?: boolean;
}

interface ActiveSession {
  id: string;
  workspacePath: string;
  session: PlatformSession;
  abortController: AbortController;
  currentProcess: ChildProcess | null;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export class CopilotPlatform implements Platform {
  readonly name = 'copilot';

  private config: CopilotConfig;
  private sessions: Map<string, ActiveSession> = new Map();
  private sessionCounter = 0;

  constructor(platformConfig: PlatformConfig) {
    this.config = {
      token: platformConfig.copilot?.token,
      model: platformConfig.copilot?.model,
      allowAllTools: platformConfig.copilot?.allow_all_tools,
      allowAllPaths: platformConfig.copilot?.allow_all_paths,
      allowedTools: platformConfig.copilot?.allowed_tools,
      additionalDirs: platformConfig.copilot?.additional_dirs,
      silent: platformConfig.copilot?.silent ?? true,
    };

    log.info('CopilotPlatform initialized', {
      model: this.config.model,
      allowAllTools: this.config.allowAllTools,
      hasToken: !!this.config.token,
    });
  }

  async createSession(options: CreateSessionOptions): Promise<string> {
    log.info('Creating Copilot session', { workspacePath: options.workspacePath });

    const sessionId = `copilot-${++this.sessionCounter}-${Date.now()}`;

    const session: PlatformSession = {
      id: sessionId,
      workspacePath: options.workspacePath,
      createdAt: new Date(),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turnCount: 0,
      lastEventType: null,
      lastEventTimestamp: null,
    };

    this.sessions.set(sessionId, {
      id: sessionId,
      workspacePath: options.workspacePath,
      session,
      abortController: new AbortController(),
      currentProcess: null,
      conversationHistory: [],
    });

    log.info('Copilot session created', { sessionId });
    return sessionId;
  }

  async resumeSession(options: ResumeSessionOptions): Promise<boolean> {
    log.info('Resuming Copilot session', { sessionId: options.sessionId });

    // Copilot CLI is stateless - we create a new session wrapper but note it's a "resume"
    const session: PlatformSession = {
      id: options.sessionId,
      workspacePath: options.workspacePath,
      createdAt: new Date(),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turnCount: 0,
      lastEventType: null,
      lastEventTimestamp: null,
    };

    this.sessions.set(options.sessionId, {
      id: options.sessionId,
      workspacePath: options.workspacePath,
      session,
      abortController: new AbortController(),
      currentProcess: null,
      conversationHistory: [],
    });

    log.info('Copilot session resumed (new CLI context)', { sessionId: options.sessionId });
    return true;
  }

  async runTurn(sessionId: string, options: RunTurnOptions): Promise<TurnResult> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const { session, abortController, workspacePath } = activeSession;
    const { prompt, timeoutMs, stallTimeoutMs, onEvent } = options;

    let lastActivityTime = Date.now();
    let completed = false;
    let error: string | undefined;
    let output = '';

    const stallChecker = stallTimeoutMs > 0 ? setInterval(() => {
      const elapsed = Date.now() - lastActivityTime;
      if (elapsed > stallTimeoutMs && activeSession.currentProcess) {
        log.warn('Copilot session stalled', { sessionId, elapsed, stallTimeoutMs });
        error = `Session stalled after ${elapsed}ms of inactivity`;
        activeSession.currentProcess.kill('SIGTERM');
      }
    }, 5000) : null;

    try {
      log.info('Running Copilot turn', {
        sessionId,
        promptLength: prompt.length,
        promptPreview: prompt.slice(0, 150) + (prompt.length > 150 ? '...' : ''),
        model: this.config.model,
      });

      onEvent(this.createEvent(sessionId, 'session_started'));

      const args = this.buildCliArgs(prompt, workspacePath);
      const env = this.buildEnvironment();

      log.debug('Spawning copilot CLI', { args: args.join(' '), workspacePath });

      const result = await this.executeCopilot(
        args,
        env,
        workspacePath,
        timeoutMs,
        abortController,
        activeSession,
        (chunk: string) => {
          lastActivityTime = Date.now();
          output += chunk;
          onEvent({
            type: 'message_updated',
            timestamp: new Date(),
            sessionId,
            messageContent: chunk,
          });
        }
      );

      if (result.exitCode === 0) {
        completed = true;
        activeSession.conversationHistory.push(
          { role: 'user', content: prompt },
          { role: 'assistant', content: output }
        );
      } else {
        error = result.error || `Copilot CLI exited with code ${result.exitCode}`;
      }

      session.turnCount++;
      session.lastEventType = completed ? 'session_idle' : 'session_error';
      session.lastEventTimestamp = new Date();

      if (completed) {
        onEvent({
          type: 'message_completed',
          timestamp: new Date(),
          sessionId,
          messageContent: output,
        });
        onEvent(this.createEvent(sessionId, 'session_idle'));
      } else {
        onEvent({
          type: 'session_error',
          timestamp: new Date(),
          sessionId,
          error: { name: 'CopilotError', message: error || 'Unknown error' },
        });
      }

      return { completed, needsInput: false, error };

    } catch (err) {
      const errorMessage = (err as Error).message;
      if (errorMessage.includes('aborted') || abortController.signal.aborted) {
        log.debug('Copilot turn aborted', { sessionId });
        return { completed: false, needsInput: false, error: 'Turn aborted' };
      }

      log.error('Copilot turn failed', { sessionId, error: errorMessage });
      return { completed: false, needsInput: false, error: errorMessage };
    } finally {
      if (stallChecker) clearInterval(stallChecker);
      activeSession.currentProcess = null;
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<boolean> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      log.warn('Cannot send message - Copilot session not found', { sessionId });
      return false;
    }

    log.info('Sending message to Copilot session', { sessionId, messageLength: message.length });

    // For Copilot CLI, sending a message means running a new turn
    // This is fire-and-forget, so we don't wait for the result
    const args = this.buildCliArgs(message, activeSession.workspacePath);
    const env = this.buildEnvironment();

    const proc = spawn('copilot', args, {
      cwd: activeSession.workspacePath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.on('error', (err) => {
      log.error('Failed to send message to Copilot session', { sessionId, error: err.message });
    });

    return true;
  }

  async replyToQuestion(_sessionId: string, _questionId: string, _answers: string[]): Promise<void> {
    // Copilot CLI in programmatic mode (-p) doesn't support interactive Q&A
    // Tool permissions should be configured via --allow-tool flags instead
    log.warn('replyToQuestion not supported in Copilot platform - use allow_all_tools or allowed_tools config');
    throw new Error('Copilot platform does not support interactive questions. Configure tool permissions via workflow config.');
  }

  async abortSession(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      return;
    }

    activeSession.abortController.abort();
    if (activeSession.currentProcess) {
      activeSession.currentProcess.kill('SIGTERM');
    }

    this.sessions.delete(sessionId);
    log.info('Copilot session aborted', { sessionId });
  }

  getSession(sessionId: string): PlatformSession | null {
    return this.sessions.get(sessionId)?.session ?? null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return await this.checkCopilotAvailable();
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      await this.abortSession(sessionId);
    }
    this.sessions.clear();
  }

  private buildCliArgs(prompt: string, workspacePath: string): string[] {
    const args: string[] = [];

    // Silent mode for cleaner output
    if (this.config.silent) {
      args.push('-s');
    }

    // Programmatic mode with prompt
    args.push('-p', prompt);

    // Model selection
    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Tool permissions
    if (this.config.allowAllTools) {
      args.push('--allow-all');
    } else if (this.config.allowedTools && this.config.allowedTools.length > 0) {
      args.push('--allow-tool', this.config.allowedTools.join(','));
    }

    // Path access
    if (this.config.allowAllPaths) {
      args.push('--allow-all-paths');
    }

    // Additional directories
    if (this.config.additionalDirs) {
      for (const dir of this.config.additionalDirs) {
        args.push('--add-dir', dir);
      }
    }

    // Prevent interactive prompts
    args.push('--no-ask-user');

    // Add workspace as context
    args.push('--add-dir', workspacePath);

    return args;
  }

  private buildEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    // Set token if configured (takes precedence over env vars)
    if (this.config.token) {
      env.COPILOT_GITHUB_TOKEN = this.config.token;
    }

    // Ensure non-interactive mode
    env.CI = 'true';

    return env;
  }

  private async executeCopilot(
    args: string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
    timeoutMs: number,
    abortController: AbortController,
    activeSession: ActiveSession,
    onChunk: (chunk: string) => void
  ): Promise<{ exitCode: number; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn('copilot', args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      activeSession.currentProcess = proc;

      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        onChunk(data.toString());
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        log.warn('Copilot turn timed out', { timeoutMs });
        proc.kill('SIGTERM');
        resolve({ exitCode: -1, error: `Turn timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      const abortHandler = () => {
        clearTimeout(timeoutId);
        proc.kill('SIGTERM');
        resolve({ exitCode: -1, error: 'Aborted' });
      };
      abortController.signal.addEventListener('abort', abortHandler);

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', abortHandler);
        resolve({ exitCode: -1, error: err.message });
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', abortHandler);
        resolve({
          exitCode: code ?? 0,
          error: code !== 0 ? stderr || undefined : undefined,
        });
      });
    });
  }

  private async checkCopilotAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('copilot', ['--help'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });
    });
  }

  private createEvent(sessionId: string, type: PlatformEventType): PlatformEvent {
    return {
      type,
      timestamp: new Date(),
      sessionId,
    };
  }
}
