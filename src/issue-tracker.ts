import { Issue, IssueComment, IssueLog, IssueSession, SessionExport } from './types.js';
import { ServiceConfig } from './config.js';
import { WorkflowStore } from './workflow-store.js';

export interface IssueCreateData {
  id?: string;
  identifier?: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  state: string;
  branchName?: string | null;
  url?: string | null;
  labels?: string[];
  workflowId?: string | null;
  model?: string | null;
}

export interface IssueUpdateData {
  title?: string;
  description?: string | null;
  priority?: number | null;
  state?: string;
  branchName?: string | null;
  url?: string | null;
  labels?: string[];
  workflowId?: string | null;
  model?: string | null;
}

export interface IssueTrackerClient {
  updateConfig(config: ServiceConfig): void;
  setWorkflowStore(store: WorkflowStore): void;
  fetchAllIssues(): Promise<Issue[]>;
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByIds(issueIds: string[]): Promise<Map<string, Issue>>;
  fetchTerminalIssues(): Promise<Issue[]>;
  isTerminalState(state: string): boolean;
  isActiveState(state: string): boolean;
  createIssue(data: IssueCreateData): Promise<Issue>;
  updateIssue(issueId: string, data: IssueUpdateData): Promise<Issue | null>;
  deleteIssue(issueId: string): Promise<boolean>;
  updateIssueState(issueId: string, newState: string): Promise<void>;
  updateIssueSessionId(issueId: string, sessionId: string | null): Promise<void>;
  updateIssueWorkspacePath(issueId: string, workspacePath: string | null): Promise<void>;
  addComment(issueId: string, author: 'human' | 'agent', content: string): Promise<IssueComment>;
  getComments(issueId: string): Promise<IssueComment[]>;
  addLog(issueId: string, content: string, sessionId?: string | null, workflowId?: string | null): Promise<IssueLog>;
  getLogs(issueId: string): Promise<IssueLog[]>;
  startWatching(onChange: () => void): Promise<void>;
  /**
   * Resolves an issue ID or identifier to the internal issue ID.
   * Accepts either the internal ID or the human-readable identifier.
   * Returns null if no matching issue is found.
   */
  resolveIssueId(idOrIdentifier: string): Promise<string | null>;
  
  createSession(
    issueId: string,
    sessionId: string,
    workflowId: string | null,
    workflowName: string | null,
    workspacePath: string | null,
    worktreeRoot?: string | null
  ): Promise<IssueSession>;
  deactivateSession(sessionId: string): Promise<void>;
  getIssueSessions(issueId: string): Promise<IssueSession[]>;
  
  // Session export methods
  saveSessionExport(issueId: string, markdownContent: string, sessionCount: number): Promise<SessionExport>;
  getSessionExport(issueId: string): Promise<SessionExport | null>;
}
