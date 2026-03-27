import { BotFrameworkAdapter, TurnContext } from 'botbuilder';
import type { ConversationReference } from 'botbuilder-core';
import type { Request, Response } from 'express';
import {
  Connector,
  ConnectorContext,
  ConnectorEvent,
  IssueStateChangedEvent,
  AgentCompletedEvent,
  AgentFailedEvent,
  InputRequestedEvent,
  CommentAddedEvent,
  IssueCreatedEvent,
} from './connector.js';
import { LocalConfigStore, TeamsConfig, TeamsNotificationLevel } from './local-config-store.js';
import { ChatManager } from './chat-manager.js';
import { Logger } from './logger.js';

const log = new Logger('teams-connector');

export interface TeamsConnectorOptions {
  localConfigStore: LocalConfigStore;
  chatManager: ChatManager;
  /** Callback to register the /api/teams/messages HTTP handler */
  registerRoute: (handler: (req: Request, res: Response) => void) => void;
}

export class TeamsConnector implements Connector {
  readonly id = 'teams';
  readonly name = 'Microsoft Teams';

  private adapter: BotFrameworkAdapter | null = null;
  private context: ConnectorContext | null = null;
  private config: TeamsConfig | null = null;
  private localConfigStore: LocalConfigStore;
  private chatManager: ChatManager;
  private registerRoute: (handler: (req: Request, res: Response) => void) => void;
  private allowedSenders: Set<string> = new Set();
  private conversationReferences: Map<string, Partial<ConversationReference>> = new Map();
  private teamsInitiatedIssues: Set<string> = new Set();

  constructor(options: TeamsConnectorOptions) {
    this.localConfigStore = options.localConfigStore;
    this.chatManager = options.chatManager;
    this.registerRoute = options.registerRoute;
  }

  async start(context: ConnectorContext): Promise<void> {
    this.context = context;

    const localConfig = await this.localConfigStore.getConfig();
    const teamsConfig = localConfig.teams;

    if (!teamsConfig?.enabled || !teamsConfig.appId || !teamsConfig.appPassword) {
      log.info('Teams connector disabled or credentials not set — skipping');
      return;
    }

    this.config = teamsConfig;
    this.allowedSenders = this.parseAllowlist(teamsConfig.allowlist ?? '');

    try {
      this.adapter = new BotFrameworkAdapter({
        appId: teamsConfig.appId,
        appPassword: teamsConfig.appPassword,
      });

      this.adapter.onTurnError = async (_turnContext, err) => {
        log.error('Teams bot turn error', { error: (err as Error).message });
      };

      // Register the webhook route
      this.registerRoute((req: Request, res: Response) => {
        this.handleRequest(req, res);
      });
      log.info('Teams connector started (webhook mode)');
    } catch (err) {
      log.error('Failed to start Teams bot', { error: (err as Error).message });
    }
  }

  onEvent(event: ConnectorEvent): void {
    if (!this.adapter || !this.config?.enabled) return;

    switch (event.type) {
      case 'issue_created':
        this.handleIssueCreated(event as IssueCreatedEvent);
        break;
      case 'issue_state_changed':
        this.handleStateChanged(event as IssueStateChangedEvent);
        break;
      case 'agent_completed':
        this.handleAgentCompleted(event as AgentCompletedEvent);
        break;
      case 'agent_failed':
        this.handleAgentFailed(event as AgentFailedEvent);
        break;
      case 'input_requested':
        this.handleInputRequested(event as InputRequestedEvent);
        break;
      case 'comment_added':
        this.handleCommentAdded(event as CommentAddedEvent);
        break;
    }
  }

  stop(): void {
    this.adapter = null;
    this.conversationReferences.clear();
    log.info('Teams connector stopped');
  }

  async reload(): Promise<void> {
    this.stop();
    if (this.context) {
      await this.start(this.context);
    }
  }

  private handleRequest(req: Request, res: Response): void {
    if (!this.adapter) {
      res.status(503).json({ error: 'Teams connector not ready' });
      return;
    }

    this.adapter.processActivity(req, res, async (turnContext) => {
      await this.onTurn(turnContext);
    }).catch((err) => {
      log.warn('Error processing Teams activity', { error: (err as Error).message });
    });
  }

  private async onTurn(turnContext: TurnContext): Promise<void> {
    if (turnContext.activity.type !== 'message') return;

    const ref = TurnContext.getConversationReference(turnContext.activity);
    const senderId = this.getSenderId(turnContext);

    if (!this.isAllowed(senderId)) {
      log.debug('Rejected message from unauthorized sender', { sender: senderId });
      return;
    }

    // Store conversation reference for proactive messaging
    const refKey = ref.conversation?.id ?? senderId;
    this.conversationReferences.set(refKey, ref);

    const text = (turnContext.activity.text ?? '').trim().replace(/<at>[^<]*<\/at>/g, '').trim();
    if (!text) return;

    try {
      await this.handleIncomingMessage(turnContext, text);
    } catch (err) {
      log.warn('Error handling Teams message', { error: (err as Error).message });
      await turnContext.sendActivity(`Error: ${(err as Error).message}`);
    }
  }

  private async handleIncomingMessage(turnContext: TurnContext, text: string): Promise<void> {
    if (!this.context) return;

    if (text.startsWith('/start') || text.startsWith('/help') || text === 'help') {
      await turnContext.sendActivity(this.getHelpText());
      return;
    }

    if (text.startsWith('/list') || text === 'list') {
      const issues = await this.context.getIssues();
      if (issues.length === 0) {
        await turnContext.sendActivity('No active cards found.');
        return;
      }
      const lines = issues.map(i => `• [${i.identifier}] ${i.state}: ${i.title}`);
      await turnContext.sendActivity(`Active cards:\n${lines.join('\n')}`);
      return;
    }

    if (text.startsWith('/comment ')) {
      const rest = text.slice('/comment '.length).trim();
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) {
        await turnContext.sendActivity('Usage: /comment <identifier> <message>');
        return;
      }
      const identifier = rest.slice(0, spaceIdx).trim();
      const comment = rest.slice(spaceIdx + 1).trim();
      const issue = await this.context.getIssue(identifier);
      if (!issue) {
        await turnContext.sendActivity(`Card not found: ${identifier}`);
        return;
      }
      await this.context.addComment(issue.id, 'human', comment);
      await turnContext.sendActivity(`Comment added to ${issue.identifier}: ${issue.title}`);
      return;
    }

    if (text.startsWith('/input ')) {
      const rest = text.slice('/input '.length).trim();
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) {
        await turnContext.sendActivity('Usage: /input <identifier> <answer>');
        return;
      }
      const identifier = rest.slice(0, spaceIdx).trim();
      const input = rest.slice(spaceIdx + 1).trim();
      const issue = await this.context.getIssue(identifier);
      if (!issue) {
        await turnContext.sendActivity(`Card not found: ${identifier}`);
        return;
      }
      const submitted = this.context.submitInput(issue.id, input);
      if (submitted) {
        await turnContext.sendActivity(`Input submitted to ${issue.identifier}.`);
      } else {
        await turnContext.sendActivity(`No pending input request for ${issue.identifier}.`);
      }
      return;
    }

    if (text.startsWith('/create ')) {
      const title = text.slice('/create '.length).trim();
      if (!title) {
        await turnContext.sendActivity('Usage: /create <title>');
        return;
      }
      const issue = await this.context.createIssue({
        title: title.slice(0, 200),
        description: title.length > 200 ? title : undefined,
        state: 'Todo',
      });
      this.teamsInitiatedIssues.add(issue.id);
      await turnContext.sendActivity(`Card created: [${issue.identifier}] ${issue.title}`);
      return;
    }

    await this.handleChatMessage(turnContext, text);
  }

  private async handleChatMessage(turnContext: TurnContext, text: string): Promise<void> {
    try {
      const response = await this.chatManager.sendMessage(text);
      const reply = response.message.trim();
      if (reply) {
        await this.safeSend(turnContext, reply);
      } else {
        await turnContext.sendActivity('No response from chat assistant.');
      }
    } catch (err) {
      log.warn('Chat message failed', { error: (err as Error).message });
      await turnContext.sendActivity(`Chat error: ${(err as Error).message}`);
    }
  }

  private handleIssueCreated(event: IssueCreatedEvent): void {
    if (!this.shouldNotifyCard(event.issue.id, this.config?.cardNotificationLevel ?? 'all')) return;
    this.broadcastToAllConversations(`New card: [${event.issue.identifier}] ${event.issue.title}`);
  }

  private handleStateChanged(event: IssueStateChangedEvent): void {
    if (!this.shouldNotifyCard(event.issueId, this.config?.cardNotificationLevel ?? 'all')) return;
    const titleLine = event.issueTitle ? `\n${event.issueTitle}` : '';
    this.broadcastToAllConversations(
      `[${event.issueIdentifier}]${titleLine}\nstate: ${event.fromState} → ${event.toState}`
    );
  }

  private handleAgentCompleted(event: AgentCompletedEvent): void {
    if (!this.shouldNotifyCard(event.issueId, this.config?.cardNotificationLevel ?? 'all')) return;
    const tokens = event.tokenUsage ? ` (${event.tokenUsage.total} tokens)` : '';
    this.broadcastToAllConversations(`Agent completed [${event.issueIdentifier}]${tokens}`);
  }

  private handleAgentFailed(event: AgentFailedEvent): void {
    if (!this.shouldNotifyCard(event.issueId, this.config?.cardNotificationLevel ?? 'all')) return;
    const retry = event.willRetry ? ' (will retry)' : '';
    this.broadcastToAllConversations(`Agent failed [${event.issueIdentifier}]: ${event.error}${retry}`);
  }

  private handleInputRequested(event: InputRequestedEvent): void {
    if (!this.shouldNotifyCard(event.issueId, this.config?.cardNotificationLevel ?? 'all')) return;
    const prompt = event.request.prompt ? `\n\nPrompt: ${event.request.prompt}` : '';
    this.broadcastToAllConversations(
      `[${event.issueIdentifier}] agent needs input.${prompt}\n\nReply with: /input ${event.issueIdentifier} <answer>`
    );
  }

  private handleCommentAdded(event: CommentAddedEvent): void {
    if (event.author !== 'agent') return;
    if (!this.shouldNotifyComment(event.issueId, this.config?.commentNotificationLevel ?? 'all')) return;
    this.broadcastToAllConversations(`[${event.issueIdentifier}] comment:\n${event.content}`);
  }

  private shouldNotifyCard(issueId: string, level: TeamsNotificationLevel): boolean {
    if (level === 'all') return true;
    return this.teamsInitiatedIssues.has(issueId);
  }

  private shouldNotifyComment(issueId: string, level: TeamsNotificationLevel): boolean {
    if (level === 'all') return true;
    return this.teamsInitiatedIssues.has(issueId);
  }

  private broadcastToAllConversations(text: string): void {
    if (!this.adapter) return;
    for (const [refKey, ref] of this.conversationReferences) {
      this.adapter.continueConversation(ref, async (ctx) => {
        await this.safeSend(ctx, text);
      }).catch((err) => {
        log.warn('Failed to send Teams proactive message', { refKey, error: (err as Error).message });
      });
    }
  }

  private async safeSend(turnContext: TurnContext, text: string): Promise<void> {
    // Teams message limit is ~28 KB; split on newlines to stay safe
    const MAX_LENGTH = 20000;
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > MAX_LENGTH) {
      const window = remaining.slice(0, MAX_LENGTH);
      const lastNewline = window.lastIndexOf('\n');
      const splitAt = lastNewline > 0 ? lastNewline + 1 : MAX_LENGTH;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
    for (const chunk of chunks) {
      try {
        await turnContext.sendActivity(chunk);
      } catch (err) {
        log.warn('Failed to send Teams message chunk', { error: (err as Error).message });
      }
    }
  }

  private getSenderId(turnContext: TurnContext): string {
    const from = turnContext.activity.from;
    return from?.aadObjectId ?? from?.id ?? '';
  }

  private isAllowed(senderId: string): boolean {
    if (this.allowedSenders.size === 0) return true;
    return this.allowedSenders.has(senderId);
  }

  private parseAllowlist(raw: string): Set<string> {
    return new Set(
      raw
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
    );
  }

  private getHelpText(): string {
    return [
      'Symphony Teams Bot',
      '',
      'Commands:',
      '/create <title> - Create a new card',
      '/list - List active cards',
      '/comment <id> <message> - Add a comment to a card',
      '/input <id> <answer> - Submit input for a waiting agent',
      '/help - Show this help',
      '',
      'Send any text to chat with the Symphony assistant.',
    ].join('\n');
  }
}
