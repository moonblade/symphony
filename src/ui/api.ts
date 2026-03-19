import type { Issue, Workflow, OrchestratorStatus, Comment, AgentLogEntry, ChatMessage, ChatSession, LocalSettings, SessionExport } from './types.js';

const API_BASE = '';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || res.statusText);
    }
    throw new Error(res.statusText || `HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON response but got ${contentType || 'unknown content type'}`);
  }
  return res.json();
}

export const api = {
  getStatus: (): Promise<OrchestratorStatus> => fetchJson('/api/status'),

  getIssues: (): Promise<Issue[]> => fetchJson('/api/issues'),

  createIssue: (data: Partial<Issue>): Promise<Issue> =>
    fetchJson('/api/issues', { method: 'POST', body: JSON.stringify(data) }),

  updateIssue: (id: string, data: Partial<Issue>): Promise<Issue> =>
    fetchJson(`/api/issues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteIssue: (id: string): Promise<void> =>
    fetchJson(`/api/issues/${id}`, { method: 'DELETE' }),

  archiveIssue: (id: string): Promise<void> =>
    fetchJson(`/api/issues/${id}/archive`, { method: 'POST' }),

  getArchivedIssues: (): Promise<Issue[]> =>
    fetchJson('/api/issues/archived'),

  unarchiveIssue: (id: string, state: string): Promise<Issue> =>
    fetchJson(`/api/issues/${id}/unarchive`, { method: 'POST', body: JSON.stringify({ state }) }),

  getIssueComments: (id: string): Promise<Comment[]> =>
    fetchJson(`/api/issues/${id}/comments`),

  addIssueComment: (id: string, author: string, content: string): Promise<Comment> =>
    fetchJson(`/api/issues/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ author, content }),
    }),

  getIssueLogs: (id: string): Promise<AgentLogEntry[]> =>
    fetchJson(`/api/issues/${id}/logs`),

  generateIdentifier: (): Promise<{ identifier: string }> =>
    fetchJson('/api/generate-identifier'),

  getWorkflows: (): Promise<Workflow[]> => fetchJson('/api/workflows'),

  getWorkflow: (id: string): Promise<Workflow> => fetchJson(`/api/workflows/${id}`),

  createWorkflow: (data: Partial<Workflow>): Promise<Workflow> =>
    fetchJson('/api/workflows', { method: 'POST', body: JSON.stringify(data) }),

  updateWorkflow: (id: string, data: Partial<Workflow>): Promise<Workflow> =>
    fetchJson(`/api/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteWorkflow: (id: string): Promise<void> =>
    fetchJson(`/api/workflows/${id}`, { method: 'DELETE' }),

  getAgentLogs: (issueId: string): Promise<AgentLogEntry[]> =>
    fetchJson(`/api/agents/${issueId}/logs`),

  submitAgentInput: (issueId: string, input: string): Promise<void> =>
    fetchJson(`/api/agents/${issueId}/input`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),

  getLogs: (): Promise<string[]> => fetchJson('/api/logs'),

  sendChatMessage: (message: string): Promise<{ message: string; sessionId: string }> =>
    fetchJson('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }),

  getChatHistory: (): Promise<ChatMessage[]> => fetchJson('/api/chat/history'),

  getChatSession: (): Promise<ChatSession> => fetchJson('/api/chat/session'),

  resetChat: (): Promise<void> => fetchJson('/api/chat/reset', { method: 'POST' }),

  getSettings: (): Promise<LocalSettings> => fetchJson('/api/settings'),

  updateSettings: (data: Partial<LocalSettings>): Promise<LocalSettings> =>
    fetchJson('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),

  exportIssueSessions: (id: string): Promise<SessionExport> =>
    fetchJson(`/api/issues/${id}/sessions/export`),
};

export interface EventSourceController {
  close: () => void;
}

export function createEventSource(
  onLog: (data: string) => void,
  onAgentLog: (issueId: string, entry: AgentLogEntry) => void,
  onIssuesUpdated: () => void,
  onStatusUpdated: () => void,
  onInputRequired: (request: { issueId: string; issueIdentifier: string; prompt: string; context?: string }) => void,
  onInputSubmitted: (data: { issueId: string }) => void,
  onWorkflowsUpdated: () => void,
  onSettingsUpdated: () => void
): EventSourceController {
  let evtSource: EventSource | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;

  function connect(): void {
    if (isClosed) return;

    evtSource = new EventSource('/api/events');

    evtSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      switch (event.type) {
        case 'log':
          onLog(event.data);
          break;
        case 'agent_log':
          onAgentLog(event.data.issueId, event.data.entry);
          break;
        case 'issues_updated':
          onIssuesUpdated();
          break;
        case 'status_updated':
          onStatusUpdated();
          break;
        case 'input_required':
          onInputRequired(event.data);
          break;
        case 'input_submitted':
          onInputSubmitted(event.data);
          break;
        case 'workflows_updated':
          onWorkflowsUpdated();
          break;
        case 'settings_updated':
          onSettingsUpdated();
          break;
      }
    };

    evtSource.onerror = () => {
      if (isClosed) return;
      console.error('SSE connection error, reconnecting in 3s...');
      evtSource?.close();
      evtSource = null;
      reconnectTimeout = setTimeout(connect, 3000);
    };
  }

  connect();

  return {
    close: () => {
      isClosed = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      evtSource?.close();
      evtSource = null;
    },
  };
}

export interface ChatEventHandlers {
  onMessageStart: () => void;
  onMessageDelta: (content: string, sessionId?: string) => void;
  onMessageComplete: () => void;
  onError: (error: string) => void;
}

export interface ChatEventSourceController {
  close: () => void;
}

export function createChatEventSource(handlers: ChatEventHandlers): ChatEventSourceController {
  let chatSse: EventSource | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;

  function connect(): void {
    if (isClosed) return;

    chatSse = new EventSource('/api/chat/stream');

    chatSse.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'message_start':
          handlers.onMessageStart();
          break;
        case 'message_delta':
          handlers.onMessageDelta(data.content, data.sessionId);
          break;
        case 'message_complete':
          handlers.onMessageComplete();
          break;
        case 'error':
          handlers.onError(data.error);
          break;
      }
    };

    chatSse.onerror = () => {
      if (isClosed) return;
      console.error('Chat SSE error, retrying in 5s...');
      chatSse?.close();
      chatSse = null;
      reconnectTimeout = setTimeout(connect, 5000);
    };
  }

  connect();

  return {
    close: () => {
      isClosed = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      chatSse?.close();
      chatSse = null;
    },
  };
}
