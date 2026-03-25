import { Connector, ConnectorContext, ConnectorEvent, CommentAddedEvent } from './connector.js';
import { IssueTrackerClient, IssueCreateData } from './issue-tracker.js';
import { Issue } from './types.js';
import { Logger } from './logger.js';

const log = new Logger('connector-manager');

export interface ConnectorManagerDeps {
  issueTracker: IssueTrackerClient;
  sendCommentToSession: (issueId: string, comment: string) => Promise<boolean>;
  submitInput: (issueId: string, input: string) => boolean;
}

export class ConnectorManager {
  private connectors: Map<string, Connector> = new Map();
  private deps: ConnectorManagerDeps;
  private started = false;

  constructor(deps: ConnectorManagerDeps) {
    this.deps = deps;
  }

  register(connector: Connector): void {
    if (this.connectors.has(connector.id)) {
      throw new Error(`Connector with id "${connector.id}" is already registered`);
    }
    this.connectors.set(connector.id, connector);
    log.info('Connector registered', { id: connector.id, name: connector.name });
  }

  async startAll(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const context = this.buildContext();

    for (const [id, connector] of this.connectors) {
      try {
        await connector.start(context);
        log.info('Connector started', { id, name: connector.name });
      } catch (err) {
        log.error('Failed to start connector', { id, error: (err as Error).message });
      }
    }
  }

  stopAll(): void {
    for (const [id, connector] of this.connectors) {
      try {
        connector.stop();
        log.debug('Connector stopped', { id });
      } catch (err) {
        log.error('Failed to stop connector', { id, error: (err as Error).message });
      }
    }
    this.connectors.clear();
    this.started = false;
  }

  emit(event: ConnectorEvent): void {
    for (const [id, connector] of this.connectors) {
      try {
        connector.onEvent(event);
      } catch (err) {
        log.warn('Connector event handler error', { connectorId: id, eventType: event.type, error: (err as Error).message });
      }
    }
  }

  getConnector(id: string): Connector | undefined {
    return this.connectors.get(id);
  }

  getConnectorIds(): string[] {
    return Array.from(this.connectors.keys());
  }

  private buildContext(): ConnectorContext {
    const { issueTracker } = this.deps;

    return {
      createIssue: async (data: IssueCreateData): Promise<Issue> => {
        const issue = await issueTracker.createIssue(data);
        this.emit({
          type: 'issue_created',
          timestamp: new Date(),
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          issue,
        } as ConnectorEvent & { issue: Issue });
        return issue;
      },

      addComment: async (issueId: string, author: 'human' | 'agent', content: string): Promise<void> => {
        const resolvedId = await issueTracker.resolveIssueId(issueId);
        if (!resolvedId) throw new Error(`Issue not found: ${issueId}`);

        const comment = await issueTracker.addComment(resolvedId, author, content);

        const issueMap = await issueTracker.fetchIssuesByIds([resolvedId]);
        const issue = issueMap.get(resolvedId);
        if (issue) {
          this.emit({
            type: 'comment_added',
            timestamp: new Date(),
            issueId: resolvedId,
            issueIdentifier: issue.identifier,
            author,
            content,
            commentId: comment.id,
          } as CommentAddedEvent);
        }

        if (author === 'human') {
          await this.deps.sendCommentToSession(resolvedId, content);
        }
      },

      updateIssueState: async (issueId: string, newState: string): Promise<void> => {
        const resolvedId = await issueTracker.resolveIssueId(issueId);
        if (!resolvedId) throw new Error(`Issue not found: ${issueId}`);

        await issueTracker.updateIssueState(resolvedId, newState);
      },

      getIssues: async (): Promise<Issue[]> => {
        return issueTracker.fetchAllIssues();
      },

      getIssue: async (idOrIdentifier: string): Promise<Issue | null> => {
        const resolvedId = await issueTracker.resolveIssueId(idOrIdentifier);
        if (!resolvedId) return null;

        const map = await issueTracker.fetchIssuesByIds([resolvedId]);
        return map.get(resolvedId) ?? null;
      },

      submitInput: (issueId: string, input: string): boolean => {
        return this.deps.submitInput(issueId, input);
      },

      sendCommentToSession: (issueId: string, comment: string): Promise<boolean> => {
        return this.deps.sendCommentToSession(issueId, comment);
      },

      getIssueTracker: (): IssueTrackerClient => {
        return issueTracker;
      },
    };
  }
}
