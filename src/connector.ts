/**
 * Symphony Connector Interface
 *
 * Connectors are bidirectional integration adapters that allow external systems
 * (Slack, email, GitHub, etc.) to interact with Symphony's orchestrator.
 *
 * Outbound: Connectors receive events from the orchestrator (issue state changes,
 * agent logs, comments, completions) and can push them to external systems.
 *
 * Inbound: Connectors can create issues, add comments, and trigger actions
 * through the ConnectorContext provided at startup.
 */

import { Issue, AgentLogEntry, InputRequest } from './types.js';
import { IssueTrackerClient, IssueCreateData } from './issue-tracker.js';

// ============================================================================
// Connector Events (Outbound: Orchestrator → Connector)
// ============================================================================

export type ConnectorEventType =
  | 'issue_created'
  | 'issue_updated'
  | 'issue_state_changed'
  | 'issue_deleted'
  | 'comment_added'
  | 'agent_started'
  | 'agent_completed'
  | 'agent_failed'
  | 'agent_log'
  | 'input_requested'
  | 'issues_changed';

export interface ConnectorEvent {
  type: ConnectorEventType;
  timestamp: Date;
  issueId?: string;
  issueIdentifier?: string;
}

export interface IssueCreatedEvent extends ConnectorEvent {
  type: 'issue_created';
  issue: Issue;
}

export interface IssueUpdatedEvent extends ConnectorEvent {
  type: 'issue_updated';
  issue: Issue;
  changes: Partial<Record<keyof Issue, { from: unknown; to: unknown }>>;
}

export interface IssueStateChangedEvent extends ConnectorEvent {
  type: 'issue_state_changed';
  issueId: string;
  issueIdentifier: string;
  fromState: string;
  toState: string;
}

export interface IssueDeletedEvent extends ConnectorEvent {
  type: 'issue_deleted';
  issueId: string;
  issueIdentifier: string;
}

export interface CommentAddedEvent extends ConnectorEvent {
  type: 'comment_added';
  issueId: string;
  issueIdentifier: string;
  author: 'human' | 'agent';
  content: string;
  commentId: string;
}

export interface AgentStartedEvent extends ConnectorEvent {
  type: 'agent_started';
  issueId: string;
  issueIdentifier: string;
  workflowId: string;
  workspacePath: string;
  sessionId?: string;
}

export interface AgentCompletedEvent extends ConnectorEvent {
  type: 'agent_completed';
  issueId: string;
  issueIdentifier: string;
  turnCount: number;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface AgentFailedEvent extends ConnectorEvent {
  type: 'agent_failed';
  issueId: string;
  issueIdentifier: string;
  error: string;
  attempt: number | null;
  willRetry: boolean;
}

export interface AgentLogEvent extends ConnectorEvent {
  type: 'agent_log';
  issueId: string;
  entry: AgentLogEntry;
}

export interface InputRequestedEvent extends ConnectorEvent {
  type: 'input_requested';
  issueId: string;
  issueIdentifier: string;
  request: InputRequest;
}

export interface IssuesChangedEvent extends ConnectorEvent {
  type: 'issues_changed';
}

export type ConnectorEventMap = {
  issue_created: IssueCreatedEvent;
  issue_updated: IssueUpdatedEvent;
  issue_state_changed: IssueStateChangedEvent;
  issue_deleted: IssueDeletedEvent;
  comment_added: CommentAddedEvent;
  agent_started: AgentStartedEvent;
  agent_completed: AgentCompletedEvent;
  agent_failed: AgentFailedEvent;
  agent_log: AgentLogEvent;
  input_requested: InputRequestedEvent;
  issues_changed: IssuesChangedEvent;
};

// ============================================================================
// Connector Context (Inbound: Connector → Orchestrator)
// ============================================================================

/**
 * Context provided to connectors for performing inbound actions.
 * This gives connectors controlled access to create issues, add comments,
 * and interact with the orchestrator without direct coupling.
 */
export interface ConnectorContext {
  /** Create a new issue in the tracker */
  createIssue(data: IssueCreateData): Promise<Issue>;
  /** Add a comment to an issue (forwards to running agent if applicable) */
  addComment(issueId: string, author: 'human' | 'agent', content: string): Promise<void>;
  /** Update an issue's state */
  updateIssueState(issueId: string, newState: string): Promise<void>;
  /** Get all non-terminal issues */
  getIssues(): Promise<Issue[]>;
  /** Get a specific issue by ID or identifier */
  getIssue(idOrIdentifier: string): Promise<Issue | null>;
  /** Submit input for a pending agent input request */
  submitInput(issueId: string, input: string): boolean;
  /** Send a comment to a running agent session */
  sendCommentToSession(issueId: string, comment: string): Promise<boolean>;
  /** Get the issue tracker client for advanced operations */
  getIssueTracker(): IssueTrackerClient;
}

// ============================================================================
// Connector Interface
// ============================================================================

/**
 * A Connector is a bidirectional integration adapter.
 *
 * Lifecycle:
 *   1. Constructor receives connector-specific config
 *   2. start(context) is called with a ConnectorContext for inbound actions
 *   3. onEvent() is called for each outbound event from the orchestrator
 *   4. stop() is called during shutdown
 *
 * Connectors should be resilient — errors in one connector must not affect
 * others or the orchestrator's core loop.
 */
export interface Connector {
  /** Unique identifier for this connector instance */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /**
   * Start the connector. Called once during orchestrator startup.
   * The context provides methods for inbound actions (creating issues, etc.)
   */
  start(context: ConnectorContext): Promise<void>;

  /**
   * Handle an outbound event from the orchestrator.
   * Implementations should be non-blocking and handle errors internally.
   */
  onEvent(event: ConnectorEvent): void;

  /**
   * Stop the connector. Called during orchestrator shutdown.
   * Should clean up any resources (timers, connections, etc.)
   */
  stop(): void;
}
