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

const log = new Logger('codex-platform');

type CodexApprovalMode = 'suggest' | 'auto-edit' | 'full-auto';

interface CodexThread {
  id: string;
  run(prompt: string): Promise<void>;
  runStreamed(prompt: string): AsyncIterable<CodexEvent>;
  abort(): void;
}

interface CodexEvent {
  type: string;
  item?: {
    type: string;
    content?: string;
    text?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface CodexInstance {
  startThread(options?: { workingDirectory?: string }): CodexThread;
}

interface ActiveSession {
  id: string;
  thread: CodexThread;
  session: PlatformSession;
  abortController: AbortController;
}

export class CodexPlatform implements Platform {
  readonly name = 'codex';
  
  private workingDirectory?: string;
  private approvalMode: CodexApprovalMode;
  private sessions: Map<string, ActiveSession> = new Map();
  private codexInstance: CodexInstance | null = null;
  private sessionCounter = 0;

  constructor(config: PlatformConfig) {
    this.workingDirectory = config.codex?.working_directory;
    this.approvalMode = config.codex?.approval_mode ?? 'suggest';
    log.info('CodexPlatform initialized', { 
      workingDirectory: this.workingDirectory, 
      approvalMode: this.approvalMode 
    });
  }

  private async getCodex(): Promise<CodexInstance> {
    if (this.codexInstance) {
      return this.codexInstance;
    }

    try {
      let codexModule: { Codex?: new () => CodexInstance; default?: new () => CodexInstance } | undefined;
      
      for (const packageName of ['@openai/codex-sdk', '@openai/codex']) {
        try {
          codexModule = await import(packageName);
          break;
        } catch {
          continue;
        }
      }

      if (!codexModule) {
        throw new Error('No Codex module found');
      }

      const Codex = codexModule.Codex || codexModule.default;
      if (!Codex) {
        throw new Error('Codex constructor not found in module');
      }
      
      this.codexInstance = new Codex() as CodexInstance;
      return this.codexInstance;
    } catch (err) {
      log.error('Failed to load Codex SDK', { error: (err as Error).message });
      throw new Error(
        'Codex platform is not yet available. The @openai/codex-sdk package is not yet publicly released. ' +
        'Please use the "opencode" platform instead, or wait for Codex SDK availability.'
      );
    }
  }

  async createSession(options: CreateSessionOptions): Promise<string> {
    log.info('Creating Codex session', { workspacePath: options.workspacePath });

    const codex = await this.getCodex();
    const thread = codex.startThread({
      workingDirectory: options.workspacePath,
    });

    const sessionId = `codex-${++this.sessionCounter}-${Date.now()}`;
    
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
      thread,
      session,
      abortController: new AbortController(),
    });

    log.info('Codex session created', { sessionId });
    return sessionId;
  }

  async resumeSession(options: ResumeSessionOptions): Promise<boolean> {
    log.info('Resuming Codex session', { sessionId: options.sessionId });
    
    // Codex threads are not persistent across process restarts
    // We create a new thread but preserve the session ID for tracking
    try {
      const codex = await this.getCodex();
      const thread = codex.startThread({
        workingDirectory: options.workspacePath,
      });

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
        thread,
        session,
        abortController: new AbortController(),
      });

      log.info('Codex session resumed (new thread created)', { sessionId: options.sessionId });
      return true;
    } catch (err) {
      log.error('Failed to resume Codex session', { 
        sessionId: options.sessionId, 
        error: (err as Error).message 
      });
      return false;
    }
  }

  async runTurn(sessionId: string, options: RunTurnOptions): Promise<TurnResult> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const { thread, session, abortController } = activeSession;
    const { prompt, timeoutMs, stallTimeoutMs, onEvent } = options;

    let lastActivityTime = Date.now();
    let completed = false;
    let error: string | undefined;

    const stallChecker = stallTimeoutMs > 0 ? setInterval(() => {
      const elapsed = Date.now() - lastActivityTime;
      if (elapsed > stallTimeoutMs) {
        log.warn('Codex session stalled', { sessionId, elapsed, stallTimeoutMs });
        error = `Session stalled after ${elapsed}ms of inactivity`;
        thread.abort();
      }
    }, 5000) : null;

    const timeoutId = setTimeout(() => {
      log.warn('Codex turn timed out', { sessionId, timeoutMs });
      error = `Turn timed out after ${timeoutMs}ms`;
      thread.abort();
    }, timeoutMs);

    try {
      log.info('Running Codex turn', { 
        sessionId, 
        promptLength: prompt.length,
        promptPreview: prompt.slice(0, 150) + (prompt.length > 150 ? '...' : ''),
      });

      onEvent(this.createEvent(sessionId, 'session_started'));

      const eventStream = thread.runStreamed(prompt);

      for await (const event of eventStream) {
        if (abortController.signal.aborted || error) {
          break;
        }

        lastActivityTime = Date.now();

        const platformEvent = this.mapEvent(sessionId, event);
        this.updateSessionFromEvent(session, platformEvent, event);
        onEvent(platformEvent);

        if (event.type === 'turn.completed' || event.type === 'response.completed') {
          completed = true;
          break;
        }

        if (event.type === 'error') {
          error = event.item?.content ?? 'Unknown Codex error';
          break;
        }
      }

      session.turnCount++;
      onEvent(this.createEvent(sessionId, completed ? 'session_idle' : 'session_error'));

      return { completed, needsInput: false, error };

    } catch (err) {
      const errorMessage = (err as Error).message;
      if (errorMessage.includes('aborted') || abortController.signal.aborted) {
        log.debug('Codex turn aborted', { sessionId });
        return { completed: false, needsInput: false, error: 'Turn aborted' };
      }
      
      log.error('Codex turn failed', { sessionId, error: errorMessage });
      return { completed: false, needsInput: false, error: errorMessage };
    } finally {
      clearTimeout(timeoutId);
      if (stallChecker) clearInterval(stallChecker);
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<boolean> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      log.warn('Cannot send message - Codex session not found', { sessionId });
      return false;
    }

    log.info('Sending message to Codex session', { sessionId, messageLength: message.length });

    // Codex doesn't support fire-and-forget messages like OpenCode
    // We run it as a turn but don't wait for completion
    activeSession.thread.run(message).catch((err) => {
      log.error('Failed to send message to Codex session', { sessionId, error: (err as Error).message });
    });

    return true;
  }

  async replyToQuestion(_sessionId: string, _questionId: string, _answers: string[]): Promise<void> {
    // Codex doesn't have the same question/answer pattern as OpenCode
    // Questions would need to be handled differently (e.g., via approval_mode configuration)
    log.warn('replyToQuestion not supported in Codex platform');
    throw new Error('Codex platform does not support interactive question/answer. Use approval_mode configuration instead.');
  }

  async abortSession(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      return;
    }

    activeSession.abortController.abort();
    activeSession.thread.abort();
    this.sessions.delete(sessionId);
    log.info('Codex session aborted', { sessionId });
  }

  getSession(sessionId: string): PlatformSession | null {
    return this.sessions.get(sessionId)?.session ?? null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getCodex();
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      await this.abortSession(sessionId);
    }
    this.sessions.clear();
    this.codexInstance = null;
  }

  private createEvent(sessionId: string, type: PlatformEventType): PlatformEvent {
    return {
      type,
      timestamp: new Date(),
      sessionId,
    };
  }

  private mapEvent(sessionId: string, event: CodexEvent): PlatformEvent {
    const eventTypeMap: Record<string, PlatformEventType> = {
      'item.created': 'message_updated',
      'item.completed': 'message_completed',
      'response.created': 'message_updated',
      'response.completed': 'turn_completed',
      'turn.completed': 'turn_completed',
      'file.edited': 'file_edited',
      'tool.started': 'tool_started',
      'tool.completed': 'tool_completed',
      'error': 'session_error',
    };

    const platformEvent: PlatformEvent = {
      type: eventTypeMap[event.type] ?? 'unknown',
      timestamp: new Date(),
      sessionId,
      rawPayload: event,
    };

    if (event.usage) {
      platformEvent.tokens = {
        input: event.usage.input_tokens,
        output: event.usage.output_tokens,
      };
    }

    if (event.item?.content || event.item?.text) {
      platformEvent.messageContent = event.item.content ?? event.item.text;
    }

    return platformEvent;
  }

  private updateSessionFromEvent(
    session: PlatformSession,
    platformEvent: PlatformEvent,
    _rawEvent: CodexEvent
  ): void {
    session.lastEventType = platformEvent.type;
    session.lastEventTimestamp = platformEvent.timestamp;

    if (platformEvent.tokens) {
      session.inputTokens += platformEvent.tokens.input;
      session.outputTokens += platformEvent.tokens.output;
      session.totalTokens += platformEvent.tokens.input + platformEvent.tokens.output;
    }
  }
}
