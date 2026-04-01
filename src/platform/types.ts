/**
 * Platform Abstraction Types
 * 
 * Defines the interface that any AI platform must implement to work with Symphony.
 * This enables pluggable platform support (OpenCode, Codex, future platforms).
 */

import { z } from 'zod';

// ============================================================================
// Platform Event Types (platform-agnostic)
// ============================================================================

/**
 * Normalized event types that all platforms must map their events to.
 */
export type PlatformEventType =
  | 'session_started'
  | 'session_idle'
  | 'session_error'
  | 'message_updated'
  | 'message_completed'
  | 'tool_started'
  | 'tool_completed'
  | 'file_edited'
  | 'turn_completed'
  | 'question_asked'
  | 'unknown';

/**
 * A question option for interactive prompts.
 */
export interface QuestionOption {
  label: string;
  description?: string;
}

/**
 * A question that requires user input.
 */
export interface PlatformQuestion {
  id: string;
  header?: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

/**
 * Normalized event emitted by all platforms.
 */
export interface PlatformEvent {
  type: PlatformEventType;
  timestamp: Date;
  sessionId: string;
  
  /** Token usage for this event (if applicable) */
  tokens?: {
    input: number;
    output: number;
  };
  
  /** Message content for message events */
  messageContent?: string;
  
  /** File path for file events */
  filePath?: string;
  
  /** Error information for error events */
  error?: {
    name: string;
    message: string;
  };
  
  /** Question data for question events */
  question?: PlatformQuestion;
  
  /** Raw platform-specific payload for debugging */
  rawPayload?: unknown;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Session state tracking.
 */
export interface PlatformSession {
  id: string;
  workspacePath: string;
  createdAt: Date;
  
  /** Total input tokens consumed */
  inputTokens: number;
  /** Total output tokens consumed */
  outputTokens: number;
  /** Total tokens consumed */
  totalTokens: number;
  /** Number of turns/interactions */
  turnCount: number;
  
  /** Last event type received */
  lastEventType: PlatformEventType | null;
  /** Last event timestamp */
  lastEventTimestamp: Date | null;
}

/**
 * Options for creating a new session.
 */
export interface CreateSessionOptions {
  workspacePath: string;
  /** Platform-specific configuration */
  platformConfig?: Record<string, unknown>;
}

/**
 * Options for resuming an existing session.
 */
export interface ResumeSessionOptions {
  sessionId: string;
  workspacePath: string;
  /** Platform-specific configuration */
  platformConfig?: Record<string, unknown>;
}

/**
 * Callback for platform events.
 */
export type PlatformEventCallback = (event: PlatformEvent) => void;

// ============================================================================
// Turn Execution Types
// ============================================================================

/**
 * Result of running a turn (prompt execution).
 */
export interface TurnResult {
  /** Whether the turn completed successfully */
  completed: boolean;
  /** Whether the turn requires user input */
  needsInput: boolean;
  /** Error message if the turn failed */
  error?: string;
  /** Prompt for user input (if needsInput is true) */
  inputPrompt?: string;
  /** Context for user input (platform-specific) */
  inputContext?: string;
}

/**
 * Options for running a turn.
 */
export interface RunTurnOptions {
  prompt: string;
  timeoutMs: number;
  stallTimeoutMs: number;
  onEvent: PlatformEventCallback;
}

// ============================================================================
// Platform Interface
// ============================================================================

/**
 * The core interface that all AI platforms must implement.
 * 
 * This abstraction allows Symphony to work with any AI coding assistant
 * that can manage sessions, execute prompts, and stream events.
 */
export interface Platform {
  /**
   * Unique identifier for this platform.
   */
  readonly name: string;
  
  /**
   * Create a new session.
   * @returns The session ID
   */
  createSession(options: CreateSessionOptions): Promise<string>;
  
  /**
   * Resume an existing session.
   * @returns true if successful, false otherwise
   */
  resumeSession(options: ResumeSessionOptions): Promise<boolean>;
  
  /**
   * Run a single turn (send a prompt and process the response).
   */
  runTurn(sessionId: string, options: RunTurnOptions): Promise<TurnResult>;
  
  /**
   * Send a message to an active session (fire-and-forget).
   * Used for forwarding comments to running agents.
   */
  sendMessage(sessionId: string, message: string): Promise<boolean>;

  checkSessionStatus?(sessionId: string): Promise<string>;
  
  /**
   * Reply to a question from the platform.
   * @param questionId The question ID to reply to
   * @param answers The user's answers
   */
  replyToQuestion(sessionId: string, questionId: string, answers: string[]): Promise<void>;
  
  /**
   * Abort/cancel a session.
   */
  abortSession(sessionId: string): Promise<void>;
  
  /**
   * Get the current session state.
   */
  getSession(sessionId: string): PlatformSession | null;
  
  /**
   * Check if the platform is healthy and ready.
   */
  healthCheck(): Promise<boolean>;
  
  /**
   * Clean up resources (called on shutdown).
   */
  dispose(): Promise<void>;
}

// ============================================================================
// Platform Configuration Schema
// ============================================================================

export const PlatformConfigSchema = z.object({
  /** Platform type: 'opencode', 'codex', or 'copilot' */
  type: z.enum(['opencode', 'codex', 'copilot']).default('opencode'),
  
  /** OpenCode-specific settings */
  opencode: z.object({
    /** Server port for OpenCode */
    server_port: z.number().optional(),
    /** Model to use */
    model: z.string().optional(),
    /** Agent to use */
    agent: z.string().optional(),
  }).optional(),
  
  /** Codex-specific settings */
  codex: z.object({
    /** Working directory for Codex */
    working_directory: z.string().optional(),
    /** Approval mode for Codex */
    approval_mode: z.enum(['suggest', 'auto-edit', 'full-auto']).optional(),
  }).optional(),
  
  /** GitHub Copilot CLI-specific settings */
  copilot: z.object({
    /** GitHub token for authentication (or use COPILOT_GITHUB_TOKEN env var) */
    token: z.string().optional(),
    /** Model to use (e.g., 'gpt-5.3-codex', 'claude-sonnet-4.6') */
    model: z.string().optional(),
    /** Allow all tool permissions (equivalent to --allow-all or --yolo) */
    allow_all_tools: z.boolean().optional(),
    /** Allow all path access */
    allow_all_paths: z.boolean().optional(),
    /** Specific tools to allow (e.g., ['shell', 'write', 'read']) */
    allowed_tools: z.array(z.string()).optional(),
    /** Additional directories to include */
    additional_dirs: z.array(z.string()).optional(),
    /** Enable silent mode (suppress decorations) */
    silent: z.boolean().optional(),
  }).optional(),
}).passthrough();

export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

// ============================================================================
// Platform Factory Types
// ============================================================================

/**
 * Factory function type for creating platform instances.
 */
export type PlatformFactory = (config: PlatformConfig) => Platform;

/**
 * Registry for platform factories.
 */
export interface PlatformRegistry {
  /**
   * Register a platform factory.
   */
  register(name: string, factory: PlatformFactory): void;
  
  /**
   * Create a platform instance.
   */
  create(config: PlatformConfig): Platform;
  
  /**
   * Get available platform names.
   */
  getAvailablePlatforms(): string[];
}
