# AGENTS.md - Symphony Project Guidelines

## Overview

Symphony is a TypeScript-based issue orchestration service that manages AI agent sessions for issue trackers (Linear, local JSON). It coordinates workspaces, runs OpenCode agents per issue, and provides a web-based Kanban UI.

## Build Commands

### npm Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run dev` | Run with hot reload (tsx) |
| `npm run start` | Run compiled CLI |
| `npm run typecheck` | Type-check without emitting |

### Makefile Shortcuts

```bash
make build      # Build project
make run        # Build and run CLI
make dev        # Development mode with hot reload
make typecheck  # Type-check only
make clean      # Remove dist/ and node_modules/
```

### Quick Reference

```bash
# Development
npm run dev

# Production build
npm run build && npm start

# Type checking before commit
npm run typecheck
```

## Project Structure

```
src/
├── cli.ts               # CLI entry point (bin: symphony)
├── mcp-server.ts        # MCP server entry point (bin: symphony-mcp)
├── index.ts             # Library exports
├── orchestrator.ts      # Main orchestration logic
├── agent-runner.ts      # OpenCode agent execution
├── types.ts             # Domain types and interfaces
├── config.ts            # Configuration management
├── workflow-loader.ts   # WORKFLOW.md parsing (bootstrap config)
├── workflow-store.ts    # Multi-workflow persistence (workflow/ folder)
├── prompt-renderer.ts   # LiquidJS template rendering
├── issue-tracker.ts     # Issue tracker interface
├── linear-client.ts     # Linear API client
├── local-client.ts      # Local JSON issue tracker
├── web-server.ts        # Express web UI server
├── workspace-manager.ts # Workspace lifecycle
├── server-manager.ts    # OpenCode server management
├── logger.ts            # Logging infrastructure
└── log.ts               # Log utilities

workflow/                # Workflow storage directory
├── workflows.json       # Workflow registry (metadata + config)
├── default-workflow.md  # Default prompt template
└── example.md           # Example workflow template
```

## Code Style Guidelines

### Import Organization

Order imports: external packages first, then local modules. Use `.js` extension for local imports.

```typescript
// External packages
import { z } from 'zod';
import express from 'express';

// Local modules (with .js extension)
import { Issue, OrchestratorState } from './types.js';
import { ServiceConfig } from './config.js';
import { Logger } from './logger.js';
```

### Type Annotations

- **Interfaces** for object shapes (data structures, configs)
- **Type aliases** for unions and enumerations
- **Explicit types** on class properties and public method signatures

```typescript
// Interface for object shapes
export interface Issue {
  id: string;
  identifier: string;
  title: string;
  state: string;
}

// Type for unions
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Explicit class property types
export class Orchestrator {
  private config: ServiceConfig;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
}
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `Orchestrator`, `AgentRunner` |
| Functions/variables | camelCase | `fetchCandidateIssues`, `isRunning` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULTS`, `LOG_LEVELS` |
| Interfaces/Types | PascalCase | `Issue`, `OrchestratorState` |
| File names | kebab-case | `agent-runner.ts`, `local-client.ts` |
| Unused params | Underscore prefix | `_req`, `_event` |

### Error Handling

Use try/catch with type assertion for error messages:

```typescript
try {
  await this.issueTracker.fetchCandidateIssues();
} catch (err) {
  log.warn('Failed to fetch issues', { error: (err as Error).message });
}
```

Create custom error classes for domain-specific errors:

```typescript
export class WorkflowError extends Error {
  constructor(
    public readonly type: WorkflowErrorType,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}
```

### Async/Await Patterns

- Always use `async`/`await` (not raw Promises)
- Return `Promise<T>` with explicit return type
- Use `Promise.race()` for timeouts

```typescript
async ensureWorkspace(identifier: string): Promise<Workspace> {
  const workspacePath = path.join(this.root, identifier);
  await fs.mkdir(workspacePath, { recursive: true });
  return { path: workspacePath };
}

// Timeout pattern
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error('Timeout')), timeoutMs);
});
await Promise.race([operation(), timeoutPromise]);
```

### Logging

Use the component-scoped `Logger` class with structured context:

```typescript
import { Logger } from './logger.js';

const log = new Logger('orchestrator');

// Usage with context object
log.info('Starting orchestrator');
log.debug('Dispatch cycle', { candidates: 5, eligible: 2 });
log.warn('Retry scheduled', { issueId, attempt, delay });
log.error('Agent run failed', { error: (err as Error).message });
```

Log levels: `debug` | `info` | `warn` | `error`

### Comments

- Minimal JSDoc for exported functions/classes
- Section dividers for grouping related code
- Underscore prefix for unused parameters

```typescript
/**
 * Symphony Domain Types
 * Based on the Symphony Service Specification
 */

// ============================================================================
// Issue Model
// ============================================================================

export interface Issue {
  // ...
}

// Forward comment to running session
this.app.post('/api/issues/:id/comments', (_req, res) => {
  // ...
});
```

## TypeScript Configuration

Key compiler options (strict mode enabled):

- **Target**: ES2022
- **Module**: NodeNext
- **Strict flags**: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- **Declaration files**: Enabled

## Dependencies

### Runtime
| Package | Purpose |
|---------|---------|
| `@linear/sdk` | Linear issue tracker integration |
| `@opencode-ai/sdk` | OpenCode AI agent SDK |
| `@modelcontextprotocol/sdk` | MCP protocol for LLM tools |
| `express` | Web UI server |
| `liquidjs` | Template rendering |
| `yaml` | Workflow config parsing |
| `zod` | Schema validation |
| `unique-names-generator` | Workspace naming |

### Dev
| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `tsx` | Development runner |
| `@types/node` | Node.js types |
| `@types/express` | Express types |

## Testing

**No test framework currently configured.**

When adding tests, use Vitest (recommended for ESM projects):

```bash
npm install -D vitest
```

## CLI Usage

```bash
symphony [options] [workflow-path]

Options:
  -w, --workflow <path>    Path to workflow.md (default: ./WORKFLOW.md)
  -l, --log-level <level>  Log level: debug|info|warn|error (default: info)
  -p, --port <port>        Web UI port (default: 3000)
  --no-web                 Disable web UI
  -h, --help               Show help
```

## MCP Server

Symphony provides an MCP server for LLM integration:

```bash
symphony-mcp --issues-path ./issues.json
```

Tools available:
- `symphony_add_comment` - Add comment to issue
- `symphony_update_state` - Update issue state

## Key Patterns

### Session Resumption
Issues store `session_id` for resumption on restart. The orchestrator checks for in-progress issues with sessions on startup and resumes them.

### Comment Forwarding
Human comments on running issues are forwarded to the agent session via `orchestrator.sendCommentToSession()`.

### Workflow System
Each issue can have a `workflow_id` pointing to a stored workflow with custom prompt template and configuration.
