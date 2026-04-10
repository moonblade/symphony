import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { Issue, Workspace } from './types.js';
import { ServiceConfig } from './config.js';
import { Logger } from './logger.js';

const log = new Logger('workspace');

const WORKSPACE_KEY_REGEX = /[^A-Za-z0-9._-]/g;

export function sanitizeWorkspaceKey(identifier: string): string {
  return identifier.replace(WORKSPACE_KEY_REGEX, '_');
}

export class WorkspaceManager {
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  updateConfig(config: ServiceConfig): void {
    this.config = config;
  }

  getWorkspacePath(issueIdentifier: string, overrideRoot?: string): string {
    const workspaceKey = sanitizeWorkspaceKey(issueIdentifier);
    const root = this.resolveWorkspaceRoot(overrideRoot);
    return path.join(root, workspaceKey);
  }

  private resolveWorkspaceRoot(overrideRoot?: string): string {
    if (overrideRoot) {
      return overrideRoot.startsWith('~') 
        ? path.join(process.env.HOME ?? '', overrideRoot.slice(1))
        : overrideRoot;
    }
    return this.config.workspaceRoot;
  }

  async ensureWorkspace(issueIdentifier: string, overrideRoot?: string): Promise<Workspace> {
    const workspaceKey = sanitizeWorkspaceKey(issueIdentifier);
    const root = this.resolveWorkspaceRoot(overrideRoot);
    const workspacePath = path.join(root, workspaceKey);

    const normalizedRoot = path.resolve(root);
    const normalizedPath = path.resolve(workspacePath);

    if (!normalizedPath.startsWith(normalizedRoot)) {
      throw new Error(`Workspace path "${workspacePath}" is outside workspace root "${normalizedRoot}"`);
    }

    let createdNow = false;

    try {
      await fs.access(workspacePath);
      log.debug('Reusing existing workspace', { path: workspacePath });
    } catch {
      log.info('Creating new workspace', { path: workspacePath });
      await fs.mkdir(workspacePath, { recursive: true });
      createdNow = true;

      if (this.config.hooksAfterCreate) {
        try {
          await this.runHook('after_create', this.config.hooksAfterCreate, workspacePath);
        } catch (err) {
          log.error('after_create hook failed, removing workspace', {
            path: workspacePath,
            error: (err as Error).message,
          });
          await fs.rm(workspacePath, { recursive: true, force: true });
          throw err;
        }
      }
    }

    return {
      path: workspacePath,
      workspaceKey,
      createdNow,
    };
  }

  async runBeforeRunHook(workspacePath: string, issue?: Issue): Promise<Record<string, string>> {
    if (!this.config.hooksBeforeRun) {
      return {};
    }

    const extraEnv: Record<string, string> = {};
    if (issue) {
      extraEnv.SYMPHONY_ISSUE_IDENTIFIER = issue.identifier;
      extraEnv.SYMPHONY_ISSUE_COMMENTS = JSON.stringify(
        issue.comments.map(c => ({
          id: c.id,
          author: c.author,
          content: c.content,
          created_at: c.createdAt?.toISOString() ?? null,
        }))
      );
    }

    const stdout = await this.runHookWithOutput('before_run', this.config.hooksBeforeRun, workspacePath, extraEnv);
    return this.parseKeyValueOutput(stdout);
  }

  private parseKeyValueOutput(output: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of output.split('\n')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();
      if (/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  resolveWorktreePathTemplate(template: string, issueIdentifier: string): string {
    const resolved = template.replace(/\{\{\s*identifier\s*\}\}/gi, issueIdentifier.toLowerCase());
    return resolved.startsWith('~')
      ? path.join(process.env.HOME ?? '', resolved.slice(1))
      : resolved;
  }

  async runAfterRunHook(workspacePath: string): Promise<void> {
    if (this.config.hooksAfterRun) {
      try {
        await this.runHook('after_run', this.config.hooksAfterRun, workspacePath);
      } catch (err) {
        log.warn('after_run hook failed (ignoring)', {
          path: workspacePath,
          error: (err as Error).message,
        });
      }
    }
  }

  async removeWorkspace(issueIdentifier: string): Promise<void> {
    const workspacePath = this.getWorkspacePath(issueIdentifier);

    try {
      await fs.access(workspacePath);
    } catch {
      return;
    }

    if (this.config.hooksBeforeRemove) {
      try {
        await this.runHook('before_remove', this.config.hooksBeforeRemove, workspacePath);
      } catch (err) {
        log.warn('before_remove hook failed (ignoring)', {
          path: workspacePath,
          error: (err as Error).message,
        });
      }
    }

    log.info('Removing workspace', { path: workspacePath });
    await fs.rm(workspacePath, { recursive: true, force: true });
  }

  async getGitWorktreeRoot(workspacePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn('git', ['-C', workspacePath, 'rev-parse', '--show-toplevel'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          resolve(null);
        }
      });
      child.on('error', () => resolve(null));
    });
  }

  async cleanupTerminalWorkspaces(terminalIdentifiers: string[]): Promise<void> {
    log.info('Starting terminal workspace cleanup', { count: terminalIdentifiers.length });

    for (const identifier of terminalIdentifiers) {
      try {
        await this.removeWorkspace(identifier);
      } catch (err) {
        log.warn('Failed to remove terminal workspace', {
          identifier,
          error: (err as Error).message,
        });
      }
    }
  }

  private runHook(name: string, script: string, cwd: string, extraEnv?: Record<string, string>): Promise<void> {
    return this.runHookWithOutput(name, script, cwd, extraEnv).then(() => undefined);
  }

  private runHookWithOutput(name: string, script: string, cwd: string, extraEnv?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      log.debug(`Running ${name} hook`, { cwd });

      const timeout = this.config.hooksTimeoutMs;
      const child = spawn('bash', ['-lc', script], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...extraEnv },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${name} hook timed out after ${timeout}ms`));
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);

        if (code === 0) {
          log.debug(`${name} hook completed`, { cwd });
          resolve(stdout);
        } else {
          log.error(`${name} hook failed`, { code, stdout, stderr });
          reject(new Error(`${name} hook failed with exit code ${code}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
