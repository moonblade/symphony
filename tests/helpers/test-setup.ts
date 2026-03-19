import express from 'express';
import { vi } from 'vitest';
import type { Issue, IssueComment, StoredWorkflow, WorkflowConfig } from '../../src/types.js';

export interface MockIssueTrackerState {
  issues: Map<string, Issue>;
  comments: Map<string, IssueComment[]>;
}

export function createMockIssueTracker(initialState?: Partial<MockIssueTrackerState>) {
  const state: MockIssueTrackerState = {
    issues: initialState?.issues ?? new Map(),
    comments: initialState?.comments ?? new Map(),
  };

  let idCounter = 1;

  return {
    state,
    
    updateConfig: vi.fn(),
    
    fetchAllIssues: vi.fn(async (): Promise<Issue[]> => {
      return Array.from(state.issues.values());
    }),
    
    fetchCandidateIssues: vi.fn(async (): Promise<Issue[]> => {
      return Array.from(state.issues.values()).filter(
        i => i.state === 'Todo' || i.state === 'In Progress'
      );
    }),
    
    fetchIssuesByIds: vi.fn(async (ids: string[]): Promise<Map<string, Issue>> => {
      const result = new Map<string, Issue>();
      for (const id of ids) {
        const issue = state.issues.get(id);
        if (issue) result.set(id, issue);
      }
      return result;
    }),
    
    fetchTerminalIssues: vi.fn(async (): Promise<Issue[]> => {
      return Array.from(state.issues.values()).filter(
        i => ['Done', 'Closed', 'Archived'].includes(i.state)
      );
    }),
    
    isTerminalState: vi.fn((s: string) => ['Done', 'Closed', 'Archived'].includes(s)),
    
    isActiveState: vi.fn((s: string) => ['Todo', 'In Progress'].includes(s)),
    
    createIssue: vi.fn(async (data: {
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
    }): Promise<Issue> => {
      const id = data.id || `issue-${idCounter++}`;
      const issue: Issue = {
        id,
        identifier: data.identifier || `test-${id}`,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? null,
        state: data.state,
        branchName: data.branchName ?? null,
        url: data.url ?? null,
        labels: data.labels ?? [],
        blockedBy: [],
        comments: [],
        workflowId: data.workflowId ?? null,
        sessionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      state.issues.set(id, issue);
      state.comments.set(id, []);
      return issue;
    }),
    
    updateIssue: vi.fn(async (id: string, data: {
      title?: string;
      description?: string | null;
      priority?: number | null;
      state?: string;
      branchName?: string | null;
      url?: string | null;
      labels?: string[];
      workflowId?: string | null;
    }): Promise<Issue | null> => {
      const issue = state.issues.get(id);
      if (!issue) return null;
      
      const updated: Issue = {
        ...issue,
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.state !== undefined && { state: data.state }),
        ...(data.branchName !== undefined && { branchName: data.branchName }),
        ...(data.url !== undefined && { url: data.url }),
        ...(data.labels !== undefined && { labels: data.labels }),
        ...(data.workflowId !== undefined && { workflowId: data.workflowId }),
        updatedAt: new Date(),
      };
      state.issues.set(id, updated);
      return updated;
    }),
    
    deleteIssue: vi.fn(async (id: string): Promise<boolean> => {
      if (!state.issues.has(id)) return false;
      state.issues.delete(id);
      state.comments.delete(id);
      return true;
    }),
    
    updateIssueState: vi.fn(async (id: string, newState: string): Promise<void> => {
      const issue = state.issues.get(id);
      if (issue) {
        issue.state = newState;
        issue.updatedAt = new Date();
      }
    }),
    
    updateIssueSessionId: vi.fn(async (id: string, sessionId: string | null): Promise<void> => {
      const issue = state.issues.get(id);
      if (issue) {
        issue.sessionId = sessionId;
        issue.updatedAt = new Date();
      }
    }),
    
    addComment: vi.fn(async (issueId: string, author: 'human' | 'agent', content: string): Promise<IssueComment> => {
      const comment: IssueComment = {
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        author,
        content,
        createdAt: new Date(),
      };
      const comments = state.comments.get(issueId) ?? [];
      comments.push(comment);
      state.comments.set(issueId, comments);
      return comment;
    }),
    
    getComments: vi.fn(async (issueId: string): Promise<IssueComment[]> => {
      return state.comments.get(issueId) ?? [];
    }),
  };
}

export interface MockWorkflowStoreState {
  workflows: Map<string, StoredWorkflow>;
}

export function createMockWorkflowStore(initialState?: Partial<MockWorkflowStoreState>) {
  const state: MockWorkflowStoreState = {
    workflows: initialState?.workflows ?? new Map(),
  };

  return {
    state,
    
    updateConfig: vi.fn(),
    
    listWorkflows: vi.fn(async (): Promise<StoredWorkflow[]> => {
      return Array.from(state.workflows.values());
    }),
    
    getWorkflow: vi.fn(async (id: string): Promise<StoredWorkflow | null> => {
      return state.workflows.get(id) ?? null;
    }),
    
    getWorkflowFresh: vi.fn(async (id: string): Promise<StoredWorkflow | null> => {
      return state.workflows.get(id) ?? null;
    }),
    
    findWorkflowByNameOrId: vi.fn(async (nameOrId: string): Promise<{
      workflow: StoredWorkflow | null;
      availableWorkflows: Array<{ id: string; name: string }>;
    }> => {
      const workflows = Array.from(state.workflows.values());
      const availableWorkflows = workflows.map(w => ({ id: w.id, name: w.name }));
      
      let workflow = workflows.find(w => w.id === nameOrId);
      if (workflow) return { workflow, availableWorkflows };
      
      workflow = workflows.find(w => w.name === nameOrId);
      if (workflow) return { workflow, availableWorkflows };
      
      const lower = nameOrId.toLowerCase();
      workflow = workflows.find(w => w.name.toLowerCase() === lower || w.id.toLowerCase() === lower);
      if (workflow) return { workflow, availableWorkflows };
      
      return { workflow: null, availableWorkflows };
    }),
    
    getDefaultWorkflow: vi.fn(async (): Promise<StoredWorkflow | null> => {
      return Array.from(state.workflows.values()).find(w => w.isDefault) ?? null;
    }),
    
    createWorkflow: vi.fn(async (data: {
      name: string;
      description?: string | null;
      promptTemplate: string;
      config?: WorkflowConfig;
      isDefault?: boolean;
      maxConcurrentAgents?: number;
    }): Promise<StoredWorkflow> => {
      const id = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const now = new Date();
      const workflow: StoredWorkflow = {
        id,
        name: data.name,
        description: data.description ?? null,
        promptTemplate: data.promptTemplate,
        config: data.config ?? {},
        isDefault: data.isDefault ?? false,
        maxConcurrentAgents: data.maxConcurrentAgents ?? 1,
        createdAt: now,
        updatedAt: now,
      };
      state.workflows.set(id, workflow);
      return workflow;
    }),
    
    updateWorkflow: vi.fn(async (id: string, data: {
      name?: string;
      description?: string | null;
      promptTemplate?: string;
      config?: WorkflowConfig;
      isDefault?: boolean;
      maxConcurrentAgents?: number;
    }): Promise<StoredWorkflow | null> => {
      const workflow = state.workflows.get(id);
      if (!workflow) return null;
      
      const updated: StoredWorkflow = {
        ...workflow,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.promptTemplate !== undefined && { promptTemplate: data.promptTemplate }),
        ...(data.config !== undefined && { config: data.config }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        ...(data.maxConcurrentAgents !== undefined && { maxConcurrentAgents: data.maxConcurrentAgents }),
        updatedAt: new Date(),
      };
      state.workflows.set(id, updated);
      return updated;
    }),
    
    deleteWorkflow: vi.fn(async (id: string): Promise<boolean> => {
      if (!state.workflows.has(id)) return false;
      state.workflows.delete(id);
      return true;
    }),
    
    getWorkflowForIssue: vi.fn(async (_issue: Issue): Promise<StoredWorkflow | null> => {
      return Array.from(state.workflows.values()).find(w => w.isDefault) ?? null;
    }),
  };
}

export function createMockOrchestrator() {
  const runningIssues: Array<{ id: string; identifier: string; startedAt: Date }> = [];
  const pendingInputs = new Set<string>();

  return {
    getStatus: vi.fn(() => ({
      running: true,
      pollIntervalMs: 30000,
      maxConcurrentAgents: 10,
      runningCount: runningIssues.length,
      runningIssues: runningIssues.map(r => ({
        id: r.id,
        identifier: r.identifier,
        startedAt: r.startedAt,
        waitingForInput: pendingInputs.has(r.id),
      })),
      retryCount: 0,
      claimedCount: 0,
      completedCount: 0,
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        runtimeSeconds: 0,
      },
    })),
    
    hasPendingInput: vi.fn((issueId: string) => pendingInputs.has(issueId)),
    
    submitInput: vi.fn((issueId: string, _input: string) => {
      if (pendingInputs.has(issueId)) {
        pendingInputs.delete(issueId);
        return true;
      }
      return false;
    }),
    
    sendCommentToSession: vi.fn(async (_issueId: string, _content: string) => {}),
    
    _addRunning: (id: string, identifier: string) => {
      runningIssues.push({ id, identifier, startedAt: new Date() });
    },
    _removeRunning: (id: string) => {
      const idx = runningIssues.findIndex(r => r.id === id);
      if (idx >= 0) runningIssues.splice(idx, 1);
    },
    _setPendingInput: (issueId: string) => {
      pendingInputs.add(issueId);
    },
    _clearPendingInput: (issueId: string) => {
      pendingInputs.delete(issueId);
    },
  };
}

export function createMockConfig() {
  return {
    trackerKind: 'local' as const,
    trackerIssuesPath: '/tmp/test-issues.db',
    workflowsDir: '/tmp/test-workflows',
    activeStates: ['Todo', 'In Progress'],
    terminalStates: ['Done', 'Closed', 'Archived'],
    pollIntervalMs: 30000,
    maxConcurrentAgents: 10,
    serverPort: 4096,
    workspaceRoot: '/tmp/test-workspaces',
    update: vi.fn(),
    validate: vi.fn(() => ({ valid: true, errors: [] })),
  };
}

export function createTestIssue(overrides?: Partial<Issue>): Issue {
  const id = `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    identifier: `test-${id.slice(-6)}`,
    title: 'Test Issue',
    description: 'Test description',
    priority: 3,
    state: 'Backlog',
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    comments: [],
    workflowId: null,
    sessionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createTestWorkflow(overrides?: Partial<StoredWorkflow>): StoredWorkflow {
  const id = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: 'Test Workflow',
    description: 'Test workflow description',
    promptTemplate: 'Test prompt template for {{ issue.title }}',
    config: {},
    isDefault: false,
    maxConcurrentAgents: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export async function createTestApp(options?: {
  issueTracker?: ReturnType<typeof createMockIssueTracker>;
  workflowStore?: ReturnType<typeof createMockWorkflowStore>;
  orchestrator?: ReturnType<typeof createMockOrchestrator>;
  config?: ReturnType<typeof createMockConfig>;
}) {
  const issueTracker = options?.issueTracker ?? createMockIssueTracker();
  const workflowStore = options?.workflowStore ?? createMockWorkflowStore();
  const orchestrator = options?.orchestrator ?? createMockOrchestrator();
  const config = options?.config ?? createMockConfig();

  const app = express();
  app.use(express.json());

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    next();
  });

  app.get('/api/status', (_req, res) => {
    const status = orchestrator.getStatus();
    res.json(status);
  });

  app.get('/api/issues', async (_req, res) => {
    try {
      const issues = await issueTracker.fetchAllIssues();
      res.json(issues);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/issues', async (req, res) => {
    try {
      const issue = await issueTracker.createIssue({
        id: req.body.id,
        identifier: req.body.identifier,
        title: req.body.title,
        description: req.body.description,
        priority: req.body.priority,
        state: req.body.state || 'Backlog',
        branchName: req.body.branch_name,
        url: req.body.url,
        labels: req.body.labels,
        workflowId: req.body.workflowId || req.body.workflow_id,
      });
      res.json(issue);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.put('/api/issues/:id', async (req, res) => {
    try {
      const issue = await issueTracker.updateIssue(req.params.id, {
        title: req.body.title,
        description: req.body.description,
        priority: req.body.priority,
        state: req.body.state,
        branchName: req.body.branch_name,
        url: req.body.url,
        labels: req.body.labels,
        workflowId: req.body.workflowId || req.body.workflow_id,
      });

      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }

      res.json(issue);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/issues/:id/comments', async (req, res) => {
    try {
      const comments = await issueTracker.getComments(req.params.id);
      res.json(comments);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/issues/:id/comments', async (req, res) => {
    try {
      const author = req.body.author || 'human';
      const content = req.body.content;

      const comment = await issueTracker.addComment(req.params.id, author, content);

      if (author === 'human') {
        await orchestrator.sendCommentToSession(req.params.id, content);
      }

      res.json(comment);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/issues/:id/handover', async (req, res) => {
    try {
      const issueId = req.params.id;
      const newState = req.body.new_state ?? req.body.state;
      const newWorkflowId = req.body.new_workflow_id ?? req.body.workflow_id;
      const notes = req.body.handover_notes ?? req.body.notes;

      let issue: Issue | null = null;

      if (newState || newWorkflowId) {
        issue = await issueTracker.updateIssue(issueId, {
          state: newState,
          workflowId: newWorkflowId,
        });
      }

      if (notes) {
        await issueTracker.addComment(issueId, 'agent', notes);
      }

      res.json({ success: true, issue });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const serializeWorkflow = (workflow: StoredWorkflow): Record<string, unknown> => ({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    promptTemplate: workflow.promptTemplate,
    config: workflow.config,
    isDefault: workflow.isDefault,
    maxConcurrentAgents: workflow.maxConcurrentAgents,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  });

  app.get('/api/workflows', async (_req, res) => {
    try {
      const workflows = await workflowStore.listWorkflows();
      res.json(workflows.map(w => serializeWorkflow(w)));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/workflows/resolve/:nameOrId', async (req, res) => {
    try {
      const result = await workflowStore.findWorkflowByNameOrId(req.params.nameOrId);
      if (!result.workflow) {
        res.status(404).json({
          error: `Workflow not found: "${req.params.nameOrId}"`,
          availableWorkflows: result.availableWorkflows,
        });
        return;
      }
      res.json(serializeWorkflow(result.workflow));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/workflows/:id', async (req, res) => {
    try {
      const workflow = await workflowStore.getWorkflowFresh(req.params.id);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      res.json(serializeWorkflow(workflow));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/workflows', async (req, res) => {
    try {
      const { name, description, promptTemplate, config, isDefault, maxConcurrentAgents } = req.body;

      if (!name || !promptTemplate) {
        res.status(400).json({ error: 'Name and promptTemplate are required' });
        return;
      }

      const workflow = await workflowStore.createWorkflow({
        name,
        description: description ?? null,
        promptTemplate,
        config: config ?? {},
        isDefault: isDefault ?? false,
        maxConcurrentAgents: typeof maxConcurrentAgents === 'number' ? maxConcurrentAgents : 1,
      });

      res.json(serializeWorkflow(workflow));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.put('/api/workflows/:id', async (req, res) => {
    try {
      const { name, description, promptTemplate, config, isDefault, maxConcurrentAgents } = req.body;

      const workflow = await workflowStore.updateWorkflow(req.params.id, {
        name,
        description,
        promptTemplate,
        config,
        isDefault,
        maxConcurrentAgents,
      });

      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }

      res.json(serializeWorkflow(workflow));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/workflows/:id', async (req, res) => {
    try {
      const deleted = await workflowStore.deleteWorkflow(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/agents', (_req, res) => {
    const status = orchestrator.getStatus();
    res.json(status.runningIssues);
  });

  app.post('/api/agents/:id/input', (req, res) => {
    const issueId = req.params.id;
    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: 'Input is required and must be a string' });
      return;
    }

    if (!orchestrator.hasPendingInput(issueId)) {
      res.status(404).json({ error: 'No pending input request for this agent' });
      return;
    }

    const success = orchestrator.submitInput(issueId, input);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to submit input' });
    }
  });

  return {
    app,
    issueTracker,
    workflowStore,
    orchestrator,
    config,
  };
}
