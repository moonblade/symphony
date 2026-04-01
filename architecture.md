# Symphony Architecture Overview

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [System Context](#system-context)
- [Core Architecture](#core-architecture)
  - [Boot Sequence](#boot-sequence)
  - [Orchestrator](#orchestrator)
  - [Agent Runner](#agent-runner)
  - [Platform Abstraction](#platform-abstraction)
- [Data Layer](#data-layer)
  - [Issue Tracker Interface](#issue-tracker-interface)
  - [SQLite Storage](#sqlite-storage)
  - [External Tracker Integrations](#external-tracker-integrations)
- [Workflow System](#workflow-system)
  - [Workflow Storage](#workflow-storage)
  - [Prompt Rendering](#prompt-rendering)
  - [Workflow Chaining](#workflow-chaining)
- [Connector Architecture](#connector-architecture)
  - [Connector Interface](#connector-interface)
  - [Kanban Connector (Web UI)](#kanban-connector-web-ui)
  - [Telegram Connector](#telegram-connector)
  - [Microsoft Teams Connector](#microsoft-teams-connector)
- [Web UI Layer](#web-ui-layer)
  - [Backend (Express)](#backend-express)
  - [Frontend (Preact + Tailwind)](#frontend-preact--tailwind)
- [MCP Server](#mcp-server)
- [Workspace Management](#workspace-management)
- [Configuration System](#configuration-system)
- [Cross-Cutting Concerns](#cross-cutting-concerns)
  - [Logging](#logging)
  - [Error Handling](#error-handling)
  - [Graceful Shutdown](#graceful-shutdown)
  - [Hot Reload](#hot-reload)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Technology Stack](#technology-stack)
- [Directory Structure](#directory-structure)

---

## High-Level Overview

Symphony is a **TypeScript-based issue orchestration service** that bridges issue trackers (Linear, GitLab, local SQLite) with AI coding agents (OpenCode, Codex, GitHub Copilot CLI). It operates as a persistent daemon that:

1. **Polls** for issues in active states (e.g., "Todo", "In Progress")
2. **Provisions** isolated workspaces per issue
3. **Dispatches** AI agents with rendered prompt templates
4. **Monitors** agent sessions for completion, failure, stalling, or idle behavior
5. **Manages** retries, state transitions, and session resumption across restarts

The system exposes a **Kanban web UI** for human interaction, a **chat assistant** for natural-language board management, **MCP tools** for agent self-service, and **messaging connectors** (Telegram, Microsoft Teams) for notifications and remote interaction.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           Symphony Service                                │
│                                                                           │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ CLI      │  │ Orchestrator │  │ Agent Runner  │  │  Platform      │   │
│  │ (Entry)  │─▶│ (Core Loop)  │─▶│ (Per-Issue)   │─▶│  Abstraction   │   │
│  └──────────┘  └──────┬───────┘  └──────────────┘  └────────┬───────┘   │
│                       │                                      │           │
│  ┌────────────────────┼──────────────────────────────────────┤           │
│  │         Connector Manager (Event Bus)                     │           │
│  │  ┌─────────┐  ┌──────────┐  ┌───────┐                   │           │
│  │  │ Kanban  │  │ Telegram │  │ Teams │                    │           │
│  │  │ (Web)   │  │          │  │       │                    │           │
│  │  └────┬────┘  └──────────┘  └───────┘                    │           │
│  └───────┼──────────────────────────────────────────────────┘           │
│          │                                                   │           │
│  ┌───────┴──────┐  ┌──────────────┐  ┌────────────────────┐ │           │
│  │ Web Server   │  │ Workflow     │  │ Workspace Manager  │ │           │
│  │ (Express)    │  │ Store        │  │ (Filesystem/Git)   │ │           │
│  └──────────────┘  └──────────────┘  └────────────────────┘ │           │
│                                                              │           │
│  ┌───────────────────────────────────────────────────────────┘           │
│  │              Issue Tracker Interface                                   │
│  │   ┌──────────────┐  ┌────────────┐  ┌──────────────┐                │
│  │   │ Local SQLite │  │ Linear API │  │ GitLab API   │                │
│  │   └──────────────┘  └────────────┘  └──────────────┘                │
│  └───────────────────────────────────────────────────────────────────────┘
│                                                                           │
│  ┌────────────────────┐  ┌──────────────────┐                            │
│  │ MCP Server         │  │ Chat Manager     │                            │
│  │ (Agent Self-Service)│  │ (NL Assistant)   │                            │
│  └────────────────────┘  └──────────────────┘                            │
└───────────────────────────────────────────────────────────────────────────┘
         │                      │                       │
    AI Platforms           External APIs           Messaging
  ┌──────────────┐     ┌───────────────┐      ┌────────────────┐
  │ OpenCode     │     │ Linear        │      │ Telegram Bot   │
  │ Codex CLI    │     │ GitLab        │      │ MS Teams Bot   │
  │ Copilot CLI  │     │               │      │                │
  └──────────────┘     └───────────────┘      └────────────────┘
```

---

## System Context

| Actor / System       | Interaction                                                        |
|----------------------|-------------------------------------------------------------------|
| **Human (Browser)**  | Kanban UI — creates/moves/comments on issues, views agent logs     |
| **Human (Chat)**     | Telegram/Teams — natural-language commands to manage the board     |
| **AI Agent**         | Receives prompts, works in workspace, calls MCP tools to update state |
| **Linear / GitLab**  | External issue trackers polled for candidates, synced bidirectionally |
| **OpenCode Server**  | Long-running server managing AI model sessions                     |

---

## Core Architecture

### Boot Sequence

The CLI entry point (`src/cli.ts`) orchestrates the full startup:

```
1. Parse CLI arguments (-w, -l, -p, --no-web, -W)
2. Load workflow configuration
   ├─ Explicit path (file or directory)
   └─ Default: ./data/workflow/workflows.json
3. Create ServiceConfig and validate
4. Initialize subsystems:
   │  ├─ IssueTracker (SQLite | Linear | GitLab)
   │  ├─ WorkspaceManager
   │  ├─ WorkflowStore
   │  ├─ LocalConfigStore
   │  └─ ServerManager (OpenCode server)
5. Start OpenCode server
6. Create Orchestrator
7. Create ConnectorManager and wire to Orchestrator
8. Register signal handlers (SIGINT, SIGTERM)
9. Start Orchestrator (cleanup → resume → poll loop)
10. Register Connectors:
    ├─ KanbanConnector (Web UI) — unless --no-web
    ├─ TelegramConnector
    └─ TeamsConnector
11. Start all connectors
12. Begin status heartbeat (60s interval)
13. Optionally start FileWatcher (--watch mode, exit 100 for restart)
```

### Orchestrator

**File**: `src/orchestrator.ts` (~1635 lines)  
**Class**: `Orchestrator`

The Orchestrator is the central coordinator. It maintains runtime state and executes the core poll-dispatch-monitor loop.

#### Runtime State (`OrchestratorState`)

```typescript
interface OrchestratorState {
  maxConcurrentAgents: number;
  running: Map<string, RunningEntry>;       // issueId → active agent session
  runningByWorkflow: Map<string, number>;   // workflowId → count of running agents
  claimed: Set<string>;                     // issueIds claimed for dispatch
  retryAttempts: Map<string, RetryEntry>;   // issueId → pending retry
  completed: Set<string>;                   // issueIds completed this session
  totals: {                                 // aggregate token/runtime stats
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    runtimeSeconds: number;
  };
}
```

#### Dispatch Cycle (Tick Loop)

```
tick()
  │
  ├─ fetchCandidateIssues() — get issues in active states
  │
  ├─ Filter: skip already running, claimed, retrying, completed
  │
  ├─ Check capacity:
  │   ├─ Global: running.size < maxConcurrentAgents
  │   ├─ Per-workflow: runningByWorkflow[wf] < workflow.maxConcurrentAgents
  │   └─ Per-state: by max_concurrent_agents_by_state config
  │
  ├─ For each eligible issue:
  │   ├─ Claim issue (add to claimed set)
  │   ├─ Resolve workflow (issue.workflowId or default)
  │   ├─ Resolve model (issue.model → workflow.models → config.model)
  │   ├─ Ensure workspace (mkdir + after_create hook)
  │   ├─ Render prompt (LiquidJS template + issue context)
  │   ├─ Auto-transition state (e.g., Todo → In Progress)
  │   ├─ Create RunningEntry
  │   └─ Launch AgentRunner.run() (async)
  │
  ├─ Reconcile: check for issues moved to terminal states while running
  │   └─ Abort those sessions
  │
  ├─ Idle detection: check for stalled sessions
  │   └─ Send idle prompt if session exceeded idle_timeout_ms
  │
  └─ Schedule next tick (pollIntervalMs, default 30s)
```

#### Session Lifecycle

```
┌─────────┐     ┌─────────────┐     ┌────────────────┐     ┌───────────┐
│  Todo   │────▶│ In Progress │────▶│    Review       │────▶│   Done    │
│(active) │     │ (agent runs) │     │(auto-transition)│     │(terminal) │
└─────────┘     └──────┬──────┘     └────────────────┘     └───────────┘
                       │
              ┌────────┴────────┐
              │   On Failure    │
              │                 │
              ▼                 ▼
        ┌──────────┐    ┌──────────┐
        │  Retry   │    │  Review  │
        │(backoff) │    │(on_failure)
        └──────────┘    └──────────┘
```

Key behaviors:
- **Session Resumption**: On restart, issues in active states with `session_id` are resumed
- **Comment Forwarding**: Human comments on running issues are sent to the agent session
- **Input Requests**: When an agent asks a question, the request is bubbled to the UI/connectors
- **Handover**: Agents can call `symphony_handover` to transition to a different workflow
- **Idle Detection**: Sessions with no events beyond `idle_timeout_ms` receive an idle nudge prompt

### Agent Runner

**File**: `src/agent-runner.ts` (~449 lines)  
**Class**: `AgentRunner`

Manages a single agent session for one issue. Responsible for:

1. **Creating/resuming** platform sessions
2. **Running turns** — sending prompts and processing streaming responses
3. **Monitoring** for timeouts (turn timeout, stall timeout)
4. **Reporting events** back to the orchestrator via callback
5. **Handling input requests** — pausing execution to wait for human input
6. **Sending messages** to active sessions (comment forwarding)

```typescript
interface AgentRunResult {
  success: boolean;
  turnCount: number;
  error?: string;
  session: LiveSession | null;
}
```

The runner tracks a `LiveSession` with token counts, turn counts, and last-event timestamps for stall detection.

### Platform Abstraction

**Directory**: `src/platform/`

Symphony supports multiple AI coding platforms through a clean interface abstraction:

```typescript
interface Platform {
  readonly name: string;
  createSession(options: CreateSessionOptions): Promise<string>;
  resumeSession(options: ResumeSessionOptions): Promise<boolean>;
  runTurn(sessionId: string, options: RunTurnOptions): Promise<TurnResult>;
  sendMessage(sessionId: string, message: string): Promise<boolean>;
  replyToQuestion(sessionId: string, questionId: string, answers: string[]): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): PlatformSession | null;
  healthCheck(): Promise<boolean>;
  dispose(): Promise<void>;
}
```

**Implementations**:

| Platform | File | Description |
|----------|------|-------------|
| `opencode` | `opencode-platform.ts` | Default. Uses `@opencode-ai/sdk` to communicate with a long-running OpenCode server |
| `codex` | `codex-platform.ts` | Wraps OpenAI's Codex CLI as a subprocess |
| `copilot` | `copilot-platform.ts` | Wraps GitHub Copilot CLI (`gh copilot`) |

**Factory & Registry** (`platform/index.ts`):
- `registerPlatform(name, factory)` — registers a platform constructor
- `createPlatform(config)` — instantiates the configured platform type
- All three built-in platforms are auto-registered at import time

**Normalized Events**: All platforms emit `PlatformEvent` objects with a normalized `PlatformEventType`:
```
session_started | session_idle | session_error | message_updated | message_completed |
tool_started | tool_completed | file_edited | turn_completed | question_asked | unknown
```

---

## Data Layer

### Issue Tracker Interface

**File**: `src/issue-tracker.ts`

Defines `IssueTrackerClient` — the contract all tracker backends implement:

```typescript
interface IssueTrackerClient {
  // Core CRUD
  fetchAllIssues(): Promise<Issue[]>;
  fetchCandidateIssues(): Promise<Issue[]>;       // Issues in active states
  fetchTerminalIssues(): Promise<Issue[]>;         // Issues in terminal states
  createIssue(data: IssueCreateData): Promise<Issue>;
  updateIssue(issueId: string, data: IssueUpdateData): Promise<Issue | null>;
  deleteIssue(issueId: string): Promise<boolean>;

  // State management
  updateIssueState(issueId: string, newState: string): Promise<void>;
  isTerminalState(state: string): boolean;
  isActiveState(state: string): boolean;

  // Session tracking
  updateIssueSessionId(issueId: string, sessionId: string | null): Promise<void>;
  updateIssueWorkspacePath(issueId: string, workspacePath: string | null): Promise<void>;

  // Comments & Logs
  addComment(issueId: string, author: 'human' | 'agent', content: string): Promise<IssueComment>;
  getComments(issueId: string): Promise<IssueComment[]>;
  addLog(issueId: string, content: string, ...): Promise<IssueLog>;

  // Session persistence
  createSession(...): Promise<IssueSession>;
  deactivateSession(sessionId: string): Promise<void>;
  getIssueSessions(issueId: string): Promise<IssueSession[]>;

  // Session exports
  saveSessionExport(issueId: string, markdownContent: string, sessionCount: number): Promise<SessionExport>;
  getSessionExport(issueId: string): Promise<SessionExport | null>;

  // File watching
  startWatching(onChange: () => void): Promise<void>;
  resolveIssueId(idOrIdentifier: string): Promise<string | null>;
}
```

### SQLite Storage

**File**: `src/local-sqlite-client.ts` (~762 lines)  
**Class**: `LocalSqliteClient`  
**Engine**: `better-sqlite3` (synchronous, embedded)

The primary storage backend. Schema:

| Table | Purpose |
|-------|---------|
| `issues` | Core issue records (id, identifier, title, description, state, workflow_id, session_id, etc.) |
| `blockers` | Issue-to-issue blocking relationships |
| `comments` | Human and agent comments per issue |
| `session_logs` | Detailed session execution logs |
| `issue_sessions` | Session history per issue (id, sessionId, workflowId, workspacePath, worktreeRoot, isActive) |
| `session_exports` | Exported session transcripts (markdown) |

**Unique identifiers**: Each issue gets a human-readable identifier generated by `unique-names-generator` (e.g., `optimistic-louse`, `brave-fox`).

### External Tracker Integrations

| Tracker | File | Notes |
|---------|------|-------|
| **Linear** | `linear-client.ts` | Uses `@linear/sdk`. Maps Linear issues to Symphony's `Issue` model. Polls via GraphQL API. |
| **GitLab** | `gitlab-client.ts` | REST API integration. Maps GitLab issues to Symphony's model. |

Both external trackers use the same `IssueTrackerClient` interface, allowing seamless swapping via config.

---

## Workflow System

### Workflow Storage

**File**: `src/workflow-store.ts`  
**Class**: `WorkflowStore`

Workflows are stored in the `data/workflow/` directory:

```
data/workflow/
├── workflows.json          # Registry: metadata + config for all workflows
├── default-workflow.md     # Default prompt template (LiquidJS)
├── code-review.md          # Example custom workflow template
└── ...
```

**StoredWorkflow** model:

```typescript
interface StoredWorkflow {
  id: string;
  name: string;
  description: string | null;
  promptTemplate: string;           // LiquidJS template content
  config: WorkflowConfig;           // Tracker, agent, hooks, platform settings
  isDefault: boolean;
  isPrivate: boolean;
  maxConcurrentAgents: number;       // Per-workflow concurrency limit
  color?: string;                    // UI display color
  nextWorkflowId: string | null;     // Chaining: auto-assign next workflow on completion
  hiddenFromPicker: boolean;         // Hide from UI workflow selector (for chained workflows)
  createdAt: Date;
  updatedAt: Date;
}
```

The WorkflowStore provides CRUD operations and also supports **private workflows** stored in a separate configurable directory.

### Prompt Rendering

**File**: `src/prompt-renderer.ts`  
**Engine**: LiquidJS

Templates have access to:

| Variable | Type | Description |
|----------|------|-------------|
| `issue.id` | string | Internal ID |
| `issue.identifier` | string | Human-readable identifier |
| `issue.title` | string | Issue title |
| `issue.description` | string/null | Description |
| `issue.priority` | number/null | 1=urgent, 4=low |
| `issue.state` | string | Current state |
| `issue.labels` | string[] | Labels |
| `issue.comments` | IssueComment[] | Comment history |
| `issue.handover_notes` | string/null | Last handover notes |
| `attempt` | number/null | Retry attempt number |

### Workflow Chaining

Workflows support automatic chaining: when an agent completes a workflow, Symphony can automatically transition the issue to a `nextWorkflowId`. This enables multi-stage pipelines (e.g., implement → code review → deploy).

---

## Connector Architecture

### Connector Interface

**File**: `src/connector.ts`

Connectors are **bidirectional integration adapters**. They form the bridge between Symphony's core orchestrator and external systems.

```
Outbound (Orchestrator → Connector):
  Events: issue_created, issue_updated, issue_state_changed, issue_deleted,
          comment_added, agent_started, agent_completed, agent_failed,
          agent_log, input_requested, issues_changed

Inbound (Connector → Orchestrator via ConnectorContext):
  Actions: createIssue, addComment, updateIssueState, getIssues,
           getIssue, submitInput, sendCommentToSession
```

```typescript
interface Connector {
  readonly id: string;
  readonly name: string;
  start(context: ConnectorContext): Promise<void>;
  onEvent(event: ConnectorEvent): void;
  stop(): void;
}
```

**ConnectorManager** (`src/connector-manager.ts`):
- Registers connectors
- Builds the `ConnectorContext` (inbound API) wired to the issue tracker and orchestrator
- Starts/stops all connectors
- Broadcasts events to all connectors (fan-out)
- Error isolation: one connector's failure doesn't affect others

### Kanban Connector (Web UI)

**File**: `src/kanban-connector.ts`  
**Class**: `KanbanConnector`

Wraps the `WebServer` as a connector. Wires up:
- Agent log callbacks → SSE broadcast
- Input request callbacks → SSE broadcast  
- Issue update callbacks → SSE broadcast
- File watching on the SQLite database → SSE broadcast

### Telegram Connector

**File**: `src/telegram-connector.ts` (~420 lines)  
**Class**: `TelegramConnector`

- Uses `node-telegram-bot-api` with long-polling
- Configurable via `local-config.json` (bot token, allowlist, notification level)
- Inbound: creates issues, adds comments via natural-language chat (powered by `ChatManager`)
- Outbound: sends notifications for state changes, agent completions/failures, input requests
- Tracks telegram-initiated issues for targeted notifications

### Microsoft Teams Connector

**File**: `src/teams-connector.ts` (~371 lines)  
**Class**: `TeamsConnector`

- Uses `botbuilder` (Bot Framework SDK)
- Registers an HTTP endpoint (`/api/teams/messages`) on the web server
- Configurable via `local-config.json` (app ID, app password, allowlist)
- Same inbound/outbound pattern as Telegram connector

---

## Web UI Layer

### Backend (Express)

**File**: `src/web-server.ts`  
**Framework**: Express 5

#### REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Issues** | | |
| GET | `/api/issues` | List all issues |
| POST | `/api/issues` | Create new issue |
| GET | `/api/issues/:id` | Get issue details |
| PUT | `/api/issues/:id` | Update issue |
| DELETE | `/api/issues/:id` | Delete issue |
| POST | `/api/issues/:id/comments` | Add comment |
| POST | `/api/issues/:id/handover` | Trigger workflow handover |
| POST | `/api/issues/:id/archive` | Archive issue |
| **Workflows** | | |
| GET | `/api/workflows` | List all workflows |
| POST | `/api/workflows` | Create workflow |
| GET | `/api/workflows/:id` | Get workflow details |
| PUT | `/api/workflows/:id` | Update workflow |
| DELETE | `/api/workflows/:id` | Delete workflow |
| **Chat** | | |
| POST | `/api/chat` | Send chat message (streaming SSE response) |
| DELETE | `/api/chat/session` | Reset chat session |
| **System** | | |
| GET | `/api/status` | Orchestrator status |
| GET | `/api/logs` | Recent log entries |
| GET | `/api/generate-identifier` | Generate random identifier |
| GET | `/events` | SSE stream (real-time updates) |

#### Server-Sent Events (SSE)

The `/events` endpoint streams real-time updates to the frontend:

| Event | Trigger |
|-------|---------|
| `issues_updated` | Any issue CRUD operation |
| `agent_log` | Agent emits a log entry |
| `input_request` | Agent requests human input |

### Frontend (Preact + Tailwind)

**Directory**: `src/ui/`  
**Build**: esbuild (via `scripts/build-ui.ts`), Tailwind CSS 4

The frontend is a **single-page Preact application** bundled at build time:

#### Components

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Root component, routing between views |
| `KanbanBoard.tsx` | 5-column drag-and-drop board |
| `KanbanColumn.tsx` | Single column with card list |
| `KanbanCard.tsx` | Individual issue card |
| `IssueModal.tsx` | Issue detail/edit modal |
| `QuickAddCard.tsx` | Quick-create card form |
| `ChatPanel.tsx` | AI chat assistant panel |
| `WorkflowsView.tsx` | Workflow management view |
| `WorkflowModal.tsx` | Workflow create/edit modal |
| `LogsView.tsx` | System log viewer |
| `AgentLogsModal.tsx` | Per-agent execution log viewer |
| `InputRequestModal.tsx` | Modal for answering agent questions |
| `ArchivedView.tsx` | Archived issues view |
| `ArchivedCardModal.tsx` | Archived card detail |
| `SettingsView.tsx` | Application settings |
| `SessionsExportViewer.tsx` | Session transcript viewer |
| `Header.tsx` | Navigation header |

#### Hooks

| Hook | Purpose |
|------|---------|
| `useAppState.ts` | Central state management — fetches issues, workflows, orchestrator status |
| `useEventSource.ts` | SSE connection management — subscribes to `/events` for real-time updates |
| `useTheme.ts` | Dark/light theme management |

#### Build Pipeline

```
src/ui/**/*.tsx  ──▶  esbuild (bundle + minify)  ──▶  dist/ui/
src/ui/tailwind.css ──▶  @tailwindcss/cli  ──▶  dist/ui/styles.css
```

---

## MCP Server

**File**: `src/mcp-server.ts`  
**Protocol**: Model Context Protocol (`@modelcontextprotocol/sdk`)

Provides tools that AI agents can call to interact with Symphony:

| Tool | Description |
|------|-------------|
| `symphony_add_comment` | Add a comment to an issue |
| `symphony_get_comments` | Get all comments for an issue |
| `symphony_update_state` | Update issue state |
| `symphony_handover` | Hand over to another workflow (with optional notes and state change) |
| `symphony_create_issue` | Create a new issue |
| `symphony_update_issue` | Update issue details |
| `symphony_list_issues` | List issues (optionally filtered by state) |
| `symphony_list_workflows` | List all available workflows |
| `symphony_get_workflow` | Get workflow details by ID or name (fuzzy match) |
| `symphony_archive_issue` | Archive an issue |
| `symphony_restart` | Trigger a graceful service restart |
| `symphony_check_health` | Health check |

The MCP server communicates with the Symphony web server via HTTP (`SYMPHONY_API_URL`).

---

## Workspace Management

**File**: `src/workspace-manager.ts`  
**Class**: `WorkspaceManager`

Each issue gets an isolated workspace directory:

```
{workspace_root}/
├── optimistic-louse/        # Workspace for issue "optimistic-louse"
├── brave-fox/               # Workspace for issue "brave-fox"
└── ...
```

Key operations:
- **`ensureWorkspace(identifier)`**: Creates workspace directory if it doesn't exist, runs `after_create` hook
- **`cleanupTerminalWorkspaces(identifiers)`**: Removes workspaces for completed/archived issues
- **`getGitWorktreeRoot(path)`**: Detects git worktree roots for workspace path tracking
- **Lifecycle hooks**: `after_create`, `before_run`, `after_run`, `before_remove` (shell commands)
- **Path safety**: Validates workspace paths stay within the root directory

Workspace roots can be configured globally or per-workflow, allowing different workflows to use different base directories.

---

## Configuration System

**File**: `src/config.ts`  
**Class**: `ServiceConfig`

Wraps the raw `WorkflowConfig` (Zod-validated) with accessor methods and defaults:

```
WorkflowConfig
├── tracker
│   ├── kind: "local" | "linear" | "gitlab"
│   ├── issues_path, api_key, project_slug, gitlab_host
│   └── auto_transition: { on_start, on_complete, on_failure }
├── workspace
│   └── root: string
├── agent
│   ├── max_concurrent_agents (global)
│   ├── max_concurrent_agents_by_state (per-state limits)
│   ├── max_retries
│   └── max_retry_backoff_ms
├── opencode
│   ├── model (string | string[] — supports multiple models)
│   ├── secondary_model
│   ├── agent
│   ├── turn_timeout_ms (default: 3,600,000 = 1 hour)
│   ├── stall_timeout_ms (default: 300,000 = 5 min)
│   ├── idle_timeout_ms (default: 120,000 = 2 min)
│   └── idle_prompt
├── hooks
│   ├── after_create, before_run, after_run, before_remove
│   └── timeout_ms (default: 60,000)
└── platform
    ├── type: "opencode" | "codex" | "copilot"
    └── (platform-specific sub-configs)
```

**Environment variable resolution**: Config values starting with `$` are resolved from environment variables.

**Local Config Store** (`src/local-config-store.ts`): Stores UI-level settings, Telegram/Teams configuration, and safe-execute mode in `data/local-config.json`.

---

## Cross-Cutting Concerns

### Logging

**File**: `src/logger.ts`  
**Class**: `Logger`

Component-scoped structured logging:

```typescript
const log = new Logger('orchestrator');
log.info('Starting agent run', { issueId, identifier, workflowId });
```

**Levels**: `debug` | `info` | `warn` | `error`  
**Format**: `[ISO_TIMESTAMP] LEVEL [component] message {context}`  
**Output**: stdout + file (`symphony.log`) + in-memory ring buffer for API access

**Log Buffer** (`src/log-buffer.ts`): Maintains an in-memory ring buffer of recent log entries, served via `GET /api/logs`.

### Error Handling

**Custom Error Classes**:

```typescript
class WorkflowError extends Error {
  constructor(
    public readonly type: WorkflowErrorType,
    message: string,
    public readonly cause?: Error
  ) { ... }
}

// WorkflowErrorType:
//   'missing_workflow_file' | 'workflow_parse_error' | 
//   'workflow_front_matter_not_a_map' | 'template_parse_error' |
//   'template_render_error'
```

**Patterns**:
- Try/catch with `(err as Error).message` for error context
- Connector errors are isolated — one connector failing doesn't crash others
- Agent failures trigger retry logic with exponential backoff
- Platform errors are caught and mapped to normalized error events

### Graceful Shutdown

```typescript
process.on('SIGINT', () => {
  connectorManager.stopAll();    // Stop all connectors
  orchestrator.stop();           // Abort running sessions, clear timers
  serverManager.stop();          // Stop OpenCode server
  process.exit(0);
});
```

The orchestrator's `stop()` method:
1. Sets `running = false`
2. Clears the poll timer
3. Aborts all running agent sessions (via `AbortController`)
4. Clears all retry timers

### Hot Reload

**File**: `src/file-watcher.ts`  
**Class**: `FileWatcher`  
**Library**: `chokidar`

When `--watch` / `-W` flag is passed:
- Watches `.ts` and `.md` files in the project root
- On change: stops orchestrator, stops server, exits with code 100
- The service script (`scripts/service.sh`) detects exit code 100 and restarts

For `WORKFLOW.md` files (legacy single-file mode):
- `WorkflowLoader.startWatching()` watches the file and hot-reloads config without restart

---

## Data Flow Diagrams

### Issue Processing Flow

```
Human creates card (UI / Telegram / Teams / API)
    │
    ▼
IssueTracker.createIssue() → SQLite INSERT
    │
    ▼
ConnectorManager.emit(issue_created) → Notify all connectors
    │
    ▼
Orchestrator.tick() detects new candidate
    │
    ├─ Check capacity (global, per-workflow, per-state)
    ├─ Claim issue
    ├─ Resolve workflow & model
    ├─ WorkspaceManager.ensureWorkspace()
    ├─ PromptRenderer.render(template, {issue, attempt})
    ├─ Auto-transition state (Todo → In Progress)
    │
    ▼
AgentRunner.run()
    ├─ Platform.createSession() or Platform.resumeSession()
    ├─ Platform.runTurn(prompt) → streaming events
    │   ├─ PlatformEvent → mapped to AgentEvent → logged
    │   ├─ Token tracking (input/output/total)
    │   └─ Stall detection timer
    ├─ On success: auto-transition (In Progress → Review)
    ├─ On failure: retry with backoff or transition to on_failure state
    └─ On input required: bubble to UI/connectors, wait for response
```

### Comment Forwarding Flow

```
Human adds comment (UI / Telegram / MCP)
    │
    ▼
IssueTracker.addComment()
    │
    ▼
ConnectorManager.emit(comment_added)
    │
    ▼
If issue has running agent:
    Orchestrator.sendCommentToSession()
        │
        ▼
    AgentRunner.sendMessage()
        │
        ▼
    Platform.sendMessage(sessionId, content)
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Language** | TypeScript 5.8 (strict mode, ES2022 target) |
| **Runtime** | Node.js >= 20 (ESM modules, NodeNext resolution) |
| **Build** | `tsc` (backend) + `esbuild` (frontend bundle) + `@tailwindcss/cli` (styles) |
| **Backend Framework** | Express 5 |
| **Frontend Framework** | Preact 10 (with htm for JSX) |
| **CSS** | Tailwind CSS 4 |
| **Database** | SQLite via `better-sqlite3` |
| **AI SDKs** | `@opencode-ai/sdk`, Codex CLI, Copilot CLI |
| **Template Engine** | LiquidJS |
| **Schema Validation** | Zod |
| **MCP Protocol** | `@modelcontextprotocol/sdk` |
| **Messaging** | `node-telegram-bot-api`, `botbuilder` (MS Teams) |
| **File Watching** | `chokidar` |
| **Testing** | Vitest + Supertest |
| **Dev Runner** | `tsx` (TypeScript execution) |

---

## Directory Structure

```
symphony/
├── src/
│   ├── cli.ts                    # CLI entry point, boot sequence
│   ├── mcp-server.ts             # MCP server (agent self-service tools)
│   ├── index.ts                  # Library exports
│   │
│   ├── orchestrator.ts           # Core poll-dispatch-monitor loop
│   ├── agent-runner.ts           # Per-issue agent session management
│   ├── types.ts                  # Domain types, interfaces, defaults
│   ├── config.ts                 # ServiceConfig wrapper
│   │
│   ├── platform/                 # AI platform abstraction
│   │   ├── types.ts              # Platform interface & event types
│   │   ├── index.ts              # Registry & factory
│   │   ├── opencode-platform.ts  # OpenCode implementation
│   │   ├── codex-platform.ts     # Codex CLI implementation
│   │   └── copilot-platform.ts   # Copilot CLI implementation
│   │
│   ├── issue-tracker.ts          # IssueTrackerClient interface
│   ├── local-sqlite-client.ts    # SQLite implementation
│   ├── linear-client.ts          # Linear API implementation
│   ├── gitlab-client.ts          # GitLab API implementation
│   │
│   ├── connector.ts              # Connector interface & event types
│   ├── connector-manager.ts      # Connector lifecycle & event bus
│   ├── kanban-connector.ts       # Web UI connector
│   ├── telegram-connector.ts     # Telegram bot connector
│   ├── teams-connector.ts        # MS Teams bot connector
│   │
│   ├── web-server.ts             # Express REST API + SSE
│   ├── chat-manager.ts           # AI chat assistant (NL → actions)
│   │
│   ├── workflow-loader.ts        # WORKFLOW.md file parser
│   ├── workflow-store.ts         # Multi-workflow CRUD persistence
│   ├── prompt-renderer.ts        # LiquidJS template rendering
│   │
│   ├── workspace-manager.ts      # Workspace directory lifecycle
│   ├── server-manager.ts         # OpenCode server process management
│   ├── local-config-store.ts     # UI settings persistence
│   │
│   ├── logger.ts                 # Structured logging
│   ├── log.ts                    # Log utilities
│   ├── log-buffer.ts             # In-memory log ring buffer
│   ├── file-watcher.ts           # Hot reload file watcher
│   ├── string-similarity.ts      # Fuzzy matching utility
│   │
│   └── ui/                       # Frontend SPA
│       ├── index.tsx             # Entry point
│       ├── App.tsx               # Root component
│       ├── api.ts                # API client
│       ├── types.ts              # Frontend types
│       ├── styles.css            # Base styles
│       ├── tailwind.css          # Tailwind entry
│       ├── components/           # 16 UI components
│       ├── hooks/                # 3 custom hooks
│       └── utils/                # Helper utilities
│
├── data/                         # Runtime data (gitignored except samples)
│   ├── issues.db                 # SQLite database
│   ├── local-config.json         # Local settings
│   └── workflow/                 # Workflow templates & registry
│       ├── workflows.json
│       └── *.md (templates)
│
├── config/                       # OpenCode config
├── scripts/                      # Build & service scripts
├── tests/                        # Vitest test suite
├── dist/                         # Compiled output
├── workspaces/                   # Agent workspaces (default root)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key Design Decisions

1. **Connector Pattern over Direct Integration**: All external systems (Web UI, Telegram, Teams) are connectors with the same interface, making it trivial to add new integrations without touching the orchestrator.

2. **Platform Abstraction**: AI platforms are behind an interface, allowing the same orchestration logic to work with OpenCode, Codex, or Copilot — switchable per-workflow.

3. **SQLite as Primary Storage**: Embedded database with no external dependencies. `better-sqlite3` provides synchronous access for simplicity while WAL mode enables concurrent reads.

4. **LiquidJS Templates**: Prompt templates are Liquid templates, providing a safe, well-known templating language without arbitrary code execution.

5. **SSE for Real-Time Updates**: Server-Sent Events provide a lightweight unidirectional push channel for the UI, avoiding WebSocket complexity.

6. **Session Resumption**: Every agent session ID is persisted, enabling the orchestrator to resume work across restarts without losing progress.

7. **Per-Workflow Concurrency**: Each workflow can define its own `maxConcurrentAgents`, preventing one workflow type from monopolizing all agent slots.

8. **Workspace Isolation**: Each issue gets its own directory, preventing cross-issue contamination and enabling clean parallel agent execution.
