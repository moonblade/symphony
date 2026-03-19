import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  createMockIssueTracker,
  createMockWorkflowStore,
  createMockOrchestrator,
  createTestIssue,
  createTestWorkflow,
} from './helpers/test-setup.js';

describe('Symphony API E2E Tests', () => {
  // ============================================================================
  // Status Endpoint
  // ============================================================================
  describe('GET /api/status', () => {
    it('should return orchestrator status', async () => {
      const { app } = await createTestApp();

      const res = await request(app).get('/api/status');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('running', true);
      expect(res.body).toHaveProperty('pollIntervalMs');
      expect(res.body).toHaveProperty('maxConcurrentAgents');
      expect(res.body).toHaveProperty('runningCount');
      expect(res.body).toHaveProperty('runningIssues');
      expect(Array.isArray(res.body.runningIssues)).toBe(true);
    });

    it('should include running issues in status', async () => {
      const orchestrator = createMockOrchestrator();
      orchestrator._addRunning('issue-1', 'TEST-1');
      orchestrator._addRunning('issue-2', 'TEST-2');

      const { app } = await createTestApp({ orchestrator });

      const res = await request(app).get('/api/status');

      expect(res.status).toBe(200);
      expect(res.body.runningCount).toBe(2);
      expect(res.body.runningIssues).toHaveLength(2);
    });
  });

  // ============================================================================
  // Issue Endpoints
  // ============================================================================
  describe('Issues API', () => {
    describe('GET /api/issues', () => {
      it('should return empty array when no issues exist', async () => {
        const { app } = await createTestApp();

        const res = await request(app).get('/api/issues');

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('should return all issues', async () => {
        const issueTracker = createMockIssueTracker();
        const issue1 = createTestIssue({ id: 'issue-1', title: 'Issue 1' });
        const issue2 = createTestIssue({ id: 'issue-2', title: 'Issue 2' });
        issueTracker.state.issues.set('issue-1', issue1);
        issueTracker.state.issues.set('issue-2', issue2);

        const { app } = await createTestApp({ issueTracker });

        const res = await request(app).get('/api/issues');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body.map((i: { title: string }) => i.title)).toContain('Issue 1');
        expect(res.body.map((i: { title: string }) => i.title)).toContain('Issue 2');
      });
    });

    describe('POST /api/issues', () => {
      it('should create a new issue with minimal data', async () => {
        const { app, issueTracker } = await createTestApp();

        const res = await request(app)
          .post('/api/issues')
          .send({ title: 'New Issue' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id');
        expect(res.body.title).toBe('New Issue');
        expect(res.body.state).toBe('Backlog');
        expect(issueTracker.createIssue).toHaveBeenCalled();
      });

      it('should create an issue with all fields', async () => {
        const { app } = await createTestApp();

        const res = await request(app)
          .post('/api/issues')
          .send({
            title: 'Full Issue',
            description: 'Detailed description',
            priority: 2,
            state: 'Todo',
            labels: ['bug', 'urgent'],
            workflow_id: 'test-workflow',
          });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Full Issue');
        expect(res.body.description).toBe('Detailed description');
        expect(res.body.priority).toBe(2);
        expect(res.body.state).toBe('Todo');
        expect(res.body.labels).toEqual(['bug', 'urgent']);
        expect(res.body.workflowId).toBe('test-workflow');
      });
    });

    describe('PUT /api/issues/:id', () => {
      it('should update an existing issue', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1', title: 'Original Title' });
        issueTracker.state.issues.set('issue-1', issue);

        const { app } = await createTestApp({ issueTracker });

        const res = await request(app)
          .put('/api/issues/issue-1')
          .send({ title: 'Updated Title', state: 'In Progress' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Updated Title');
        expect(res.body.state).toBe('In Progress');
      });

      it('should return 404 for non-existent issue', async () => {
        const { app } = await createTestApp();

        const res = await request(app)
          .put('/api/issues/non-existent')
          .send({ title: 'Updated' });

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      });

      it('should update issue labels', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1', labels: ['old-label'] });
        issueTracker.state.issues.set('issue-1', issue);

        const { app } = await createTestApp({ issueTracker });

        const res = await request(app)
          .put('/api/issues/issue-1')
          .send({ labels: ['new-label', 'another-label'] });

        expect(res.status).toBe(200);
        expect(res.body.labels).toEqual(['new-label', 'another-label']);
      });
    });

    describe('GET /api/issues/:id/comments', () => {
      it('should return empty array when no comments exist', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1' });
        issueTracker.state.issues.set('issue-1', issue);
        issueTracker.state.comments.set('issue-1', []);

        const { app } = await createTestApp({ issueTracker });

        const res = await request(app).get('/api/issues/issue-1/comments');

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('should return all comments for an issue', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1' });
        issueTracker.state.issues.set('issue-1', issue);
        issueTracker.state.comments.set('issue-1', [
          { id: 'c1', author: 'human', content: 'First comment', createdAt: new Date() },
          { id: 'c2', author: 'agent', content: 'Agent response', createdAt: new Date() },
        ]);

        const { app } = await createTestApp({ issueTracker });

        const res = await request(app).get('/api/issues/issue-1/comments');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body[0].content).toBe('First comment');
        expect(res.body[1].content).toBe('Agent response');
      });
    });

    describe('POST /api/issues/:id/comments', () => {
      it('should add a human comment', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1' });
        issueTracker.state.issues.set('issue-1', issue);
        issueTracker.state.comments.set('issue-1', []);

        const { app, orchestrator } = await createTestApp({ issueTracker });

        const res = await request(app)
          .post('/api/issues/issue-1/comments')
          .send({ content: 'New comment from human' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id');
        expect(res.body.author).toBe('human');
        expect(res.body.content).toBe('New comment from human');
        expect(orchestrator.sendCommentToSession).toHaveBeenCalledWith('issue-1', 'New comment from human');
      });

      it('should add an agent comment without forwarding', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1' });
        issueTracker.state.issues.set('issue-1', issue);
        issueTracker.state.comments.set('issue-1', []);

        const { app, orchestrator } = await createTestApp({ issueTracker });

        const res = await request(app)
          .post('/api/issues/issue-1/comments')
          .send({ author: 'agent', content: 'Agent note' });

        expect(res.status).toBe(200);
        expect(res.body.author).toBe('agent');
        expect(orchestrator.sendCommentToSession).not.toHaveBeenCalled();
      });
    });

    describe('POST /api/issues/:id/handover', () => {
      it('should update issue state on handover', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1', state: 'In Progress' });
        issueTracker.state.issues.set('issue-1', issue);

        const { app } = await createTestApp({ issueTracker });

        const res = await request(app)
          .post('/api/issues/issue-1/handover')
          .send({ new_state: 'Review' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.issue.state).toBe('Review');
      });

      it('should add handover notes as agent comment', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1' });
        issueTracker.state.issues.set('issue-1', issue);
        issueTracker.state.comments.set('issue-1', []);

        const { app } = await createTestApp({ issueTracker });

        const res = await request(app)
          .post('/api/issues/issue-1/handover')
          .send({ handover_notes: 'Work completed, needs review' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(issueTracker.addComment).toHaveBeenCalledWith('issue-1', 'agent', 'Work completed, needs review');
      });

      it('should update workflow on handover', async () => {
        const issueTracker = createMockIssueTracker();
        const issue = createTestIssue({ id: 'issue-1', workflowId: 'old-workflow' });
        issueTracker.state.issues.set('issue-1', issue);

        const { app } = await createTestApp({ issueTracker });

        const res = await request(app)
          .post('/api/issues/issue-1/handover')
          .send({ new_workflow_id: 'new-workflow' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.issue.workflowId).toBe('new-workflow');
      });
    });
  });

  // ============================================================================
  // Workflow Endpoints
  // ============================================================================
  describe('Workflows API', () => {
    describe('GET /api/workflows', () => {
      it('should return empty array when no workflows exist', async () => {
        const { app } = await createTestApp();

        const res = await request(app).get('/api/workflows');

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('should return all workflows', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow1 = createTestWorkflow({ id: 'wf-1', name: 'Workflow 1' });
        const workflow2 = createTestWorkflow({ id: 'wf-2', name: 'Workflow 2' });
        workflowStore.state.workflows.set('wf-1', workflow1);
        workflowStore.state.workflows.set('wf-2', workflow2);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app).get('/api/workflows');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body.map((w: { name: string }) => w.name)).toContain('Workflow 1');
        expect(res.body.map((w: { name: string }) => w.name)).toContain('Workflow 2');
      });

      it('should serialize dates as ISO strings', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow = createTestWorkflow({ id: 'wf-1' });
        workflowStore.state.workflows.set('wf-1', workflow);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app).get('/api/workflows');

        expect(res.status).toBe(200);
        expect(typeof res.body[0].createdAt).toBe('string');
        expect(typeof res.body[0].updatedAt).toBe('string');
      });
    });

    describe('GET /api/workflows/:id', () => {
      it('should return a specific workflow', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow = createTestWorkflow({ id: 'wf-1', name: 'Test Workflow' });
        workflowStore.state.workflows.set('wf-1', workflow);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app).get('/api/workflows/wf-1');

        expect(res.status).toBe(200);
        expect(res.body.id).toBe('wf-1');
        expect(res.body.name).toBe('Test Workflow');
      });

      it('should return 404 for non-existent workflow', async () => {
        const { app } = await createTestApp();

        const res = await request(app).get('/api/workflows/non-existent');

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      });
    });

    describe('GET /api/workflows/resolve/:nameOrId', () => {
      it('should resolve workflow by exact ID', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow = createTestWorkflow({ id: 'wf-123', name: 'My Workflow' });
        workflowStore.state.workflows.set('wf-123', workflow);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app).get('/api/workflows/resolve/wf-123');

        expect(res.status).toBe(200);
        expect(res.body.id).toBe('wf-123');
      });

      it('should resolve workflow by name', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow = createTestWorkflow({ id: 'wf-123', name: 'My Workflow' });
        workflowStore.state.workflows.set('wf-123', workflow);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app).get('/api/workflows/resolve/My%20Workflow');

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('My Workflow');
      });

      it('should return 404 with available workflows when not found', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow = createTestWorkflow({ id: 'wf-1', name: 'Existing Workflow' });
        workflowStore.state.workflows.set('wf-1', workflow);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app).get('/api/workflows/resolve/non-existent');

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
        expect(res.body).toHaveProperty('availableWorkflows');
        expect(res.body.availableWorkflows).toContainEqual({ id: 'wf-1', name: 'Existing Workflow' });
      });
    });

    describe('POST /api/workflows', () => {
      it('should create a new workflow', async () => {
        const { app, workflowStore } = await createTestApp();

        const res = await request(app)
          .post('/api/workflows')
          .send({
            name: 'New Workflow',
            promptTemplate: 'Work on {{ issue.title }}',
          });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id');
        expect(res.body.name).toBe('New Workflow');
        expect(res.body.promptTemplate).toBe('Work on {{ issue.title }}');
        expect(workflowStore.createWorkflow).toHaveBeenCalled();
      });

      it('should create workflow with all fields', async () => {
        const { app } = await createTestApp();

        const res = await request(app)
          .post('/api/workflows')
          .send({
            name: 'Full Workflow',
            description: 'A complete workflow',
            promptTemplate: 'Complete task: {{ issue.title }}',
            config: { timeout: 3600 },
            isDefault: true,
            maxConcurrentAgents: 5,
          });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Full Workflow');
        expect(res.body.description).toBe('A complete workflow');
        expect(res.body.config).toEqual({ timeout: 3600 });
        expect(res.body.isDefault).toBe(true);
        expect(res.body.maxConcurrentAgents).toBe(5);
      });

      it('should return 400 when name is missing', async () => {
        const { app } = await createTestApp();

        const res = await request(app)
          .post('/api/workflows')
          .send({ promptTemplate: 'Some template' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Name');
      });

      it('should return 400 when promptTemplate is missing', async () => {
        const { app } = await createTestApp();

        const res = await request(app)
          .post('/api/workflows')
          .send({ name: 'Workflow Name' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('promptTemplate');
      });
    });

    describe('PUT /api/workflows/:id', () => {
      it('should update an existing workflow', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow = createTestWorkflow({ id: 'wf-1', name: 'Original Name' });
        workflowStore.state.workflows.set('wf-1', workflow);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app)
          .put('/api/workflows/wf-1')
          .send({ name: 'Updated Name', isDefault: true });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Updated Name');
        expect(res.body.isDefault).toBe(true);
      });

      it('should return 404 for non-existent workflow', async () => {
        const { app } = await createTestApp();

        const res = await request(app)
          .put('/api/workflows/non-existent')
          .send({ name: 'Updated' });

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      });

      it('should update workflow prompt template', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow = createTestWorkflow({
          id: 'wf-1',
          promptTemplate: 'Old template',
        });
        workflowStore.state.workflows.set('wf-1', workflow);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app)
          .put('/api/workflows/wf-1')
          .send({ promptTemplate: 'New template for {{ issue.identifier }}' });

        expect(res.status).toBe(200);
        expect(res.body.promptTemplate).toBe('New template for {{ issue.identifier }}');
      });
    });

    describe('DELETE /api/workflows/:id', () => {
      it('should delete an existing workflow', async () => {
        const workflowStore = createMockWorkflowStore();
        const workflow = createTestWorkflow({ id: 'wf-1' });
        workflowStore.state.workflows.set('wf-1', workflow);

        const { app } = await createTestApp({ workflowStore });

        const res = await request(app).delete('/api/workflows/wf-1');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(workflowStore.deleteWorkflow).toHaveBeenCalledWith('wf-1');
      });

      it('should return 404 for non-existent workflow', async () => {
        const { app } = await createTestApp();

        const res = await request(app).delete('/api/workflows/non-existent');

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      });
    });
  });

  // ============================================================================
  // Agent Endpoints
  // ============================================================================
  describe('Agents API', () => {
    describe('GET /api/agents', () => {
      it('should return empty array when no agents running', async () => {
        const { app } = await createTestApp();

        const res = await request(app).get('/api/agents');

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('should return running agents', async () => {
        const orchestrator = createMockOrchestrator();
        orchestrator._addRunning('issue-1', 'TEST-1');
        orchestrator._addRunning('issue-2', 'TEST-2');

        const { app } = await createTestApp({ orchestrator });

        const res = await request(app).get('/api/agents');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body.map((a: { identifier: string }) => a.identifier)).toContain('TEST-1');
        expect(res.body.map((a: { identifier: string }) => a.identifier)).toContain('TEST-2');
      });

      it('should indicate waiting for input status', async () => {
        const orchestrator = createMockOrchestrator();
        orchestrator._addRunning('issue-1', 'TEST-1');
        orchestrator._setPendingInput('issue-1');

        const { app } = await createTestApp({ orchestrator });

        const res = await request(app).get('/api/agents');

        expect(res.status).toBe(200);
        expect(res.body[0].waitingForInput).toBe(true);
      });
    });

    describe('POST /api/agents/:id/input', () => {
      it('should submit input to waiting agent', async () => {
        const orchestrator = createMockOrchestrator();
        orchestrator._addRunning('issue-1', 'TEST-1');
        orchestrator._setPendingInput('issue-1');

        const { app } = await createTestApp({ orchestrator });

        const res = await request(app)
          .post('/api/agents/issue-1/input')
          .send({ input: 'User response' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(orchestrator.submitInput).toHaveBeenCalledWith('issue-1', 'User response');
      });

      it('should return 404 when no pending input', async () => {
        const orchestrator = createMockOrchestrator();
        orchestrator._addRunning('issue-1', 'TEST-1');

        const { app } = await createTestApp({ orchestrator });

        const res = await request(app)
          .post('/api/agents/issue-1/input')
          .send({ input: 'User response' });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('No pending input');
      });

      it('should return 400 when input is missing', async () => {
        const orchestrator = createMockOrchestrator();
        orchestrator._addRunning('issue-1', 'TEST-1');
        orchestrator._setPendingInput('issue-1');

        const { app } = await createTestApp({ orchestrator });

        const res = await request(app)
          .post('/api/agents/issue-1/input')
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Input is required');
      });

      it('should return 400 when input is not a string', async () => {
        const orchestrator = createMockOrchestrator();
        orchestrator._addRunning('issue-1', 'TEST-1');
        orchestrator._setPendingInput('issue-1');

        const { app } = await createTestApp({ orchestrator });

        const res = await request(app)
          .post('/api/agents/issue-1/input')
          .send({ input: 123 });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('must be a string');
      });
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle CORS headers', async () => {
      const { app } = await createTestApp();

      const res = await request(app).get('/api/status');

      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toContain('GET');
    });

    it('should handle JSON parsing', async () => {
      const { app } = await createTestApp();

      const res = await request(app)
        .post('/api/issues')
        .set('Content-Type', 'application/json')
        .send('{ "title": "Test Issue" }');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Issue');
    });

    it('should handle empty request body for issue creation', async () => {
      const { app } = await createTestApp();

      const res = await request(app)
        .post('/api/issues')
        .send({});

      expect(res.status).toBe(200);
    });
  });

  // ============================================================================
  // Integration Scenarios
  // ============================================================================
  describe('Integration Scenarios', () => {
    it('should create issue, update it, add comment, then handover', async () => {
      const { app } = await createTestApp();

      const createRes = await request(app)
        .post('/api/issues')
        .send({ title: 'Integration Test Issue', state: 'Todo' });
      expect(createRes.status).toBe(200);
      const issueId = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/issues/${issueId}`)
        .send({ state: 'In Progress', description: 'Working on it' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.state).toBe('In Progress');

      const commentRes = await request(app)
        .post(`/api/issues/${issueId}/comments`)
        .send({ content: 'Making progress' });
      expect(commentRes.status).toBe(200);

      const handoverRes = await request(app)
        .post(`/api/issues/${issueId}/handover`)
        .send({ new_state: 'Review', handover_notes: 'Ready for review' });
      expect(handoverRes.status).toBe(200);
      expect(handoverRes.body.success).toBe(true);
    });

    it('should create workflow and assign to issue', async () => {
      const { app } = await createTestApp();

      const workflowRes = await request(app)
        .post('/api/workflows')
        .send({
          name: 'Code Review Workflow',
          promptTemplate: 'Review code for {{ issue.title }}',
        });
      expect(workflowRes.status).toBe(200);
      const workflowId = workflowRes.body.id;

      const issueRes = await request(app)
        .post('/api/issues')
        .send({
          title: 'Code to review',
          state: 'Todo',
          workflow_id: workflowId,
        });
      expect(issueRes.status).toBe(200);
      expect(issueRes.body.workflowId).toBe(workflowId);
    });

    it('should track multiple running agents', async () => {
      const orchestrator = createMockOrchestrator();
      const { app } = await createTestApp({ orchestrator });

      let res = await request(app).get('/api/agents');
      expect(res.body).toHaveLength(0);

      orchestrator._addRunning('issue-1', 'TEST-1');
      res = await request(app).get('/api/agents');
      expect(res.body).toHaveLength(1);

      orchestrator._addRunning('issue-2', 'TEST-2');
      res = await request(app).get('/api/agents');
      expect(res.body).toHaveLength(2);

      orchestrator._removeRunning('issue-1');
      res = await request(app).get('/api/agents');
      expect(res.body).toHaveLength(1);
      expect(res.body[0].identifier).toBe('TEST-2');
    });
  });
});
