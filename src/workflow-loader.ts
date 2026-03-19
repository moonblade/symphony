import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { WorkflowDefinition, WorkflowConfig, WorkflowConfigSchema, WorkflowError } from './types.js';
import { info, warn, debug } from './log.js';

const FRONT_MATTER_DELIMITER = '---';

export class WorkflowLoader {
  private currentDefinition: WorkflowDefinition | null = null;
  private workflowPath: string;
  private onReload?: (def: WorkflowDefinition) => void;

  constructor(workflowPath?: string) {
    this.workflowPath = workflowPath ?? path.join(process.cwd(), 'WORKFLOW.md');
  }

  async load(): Promise<WorkflowDefinition> {
    debug('Loading workflow', { path: this.workflowPath });

    let content: string;
    try {
      content = await fs.readFile(this.workflowPath, 'utf-8');
    } catch (err) {
      throw new WorkflowError(
        'missing_workflow_file',
        `Cannot read workflow file: ${this.workflowPath}`,
        err as Error
      );
    }

    const definition = this.parse(content);
    this.currentDefinition = definition;
    info('Workflow loaded', { path: this.workflowPath });
    return definition;
  }

  private parse(content: string): WorkflowDefinition {
    const lines = content.split('\n');
    let config: WorkflowConfig = {};
    let promptTemplate: string;

    if (lines[0]?.trim() === FRONT_MATTER_DELIMITER) {
      const endIndex = lines.slice(1).findIndex(line => line.trim() === FRONT_MATTER_DELIMITER);
      if (endIndex === -1) {
        throw new WorkflowError(
          'workflow_parse_error',
          'Unclosed YAML front matter: missing closing ---'
        );
      }

      const frontMatterLines = lines.slice(1, endIndex + 1);
      const frontMatterContent = frontMatterLines.join('\n');

      try {
        const parsed = yaml.parse(frontMatterContent);
        if (parsed !== null && typeof parsed !== 'object') {
          throw new WorkflowError(
            'workflow_front_matter_not_a_map',
            'YAML front matter must be a map/object'
          );
        }
        config = parsed ?? {};
      } catch (err) {
        if (err instanceof WorkflowError) throw err;
        throw new WorkflowError(
          'workflow_parse_error',
          `Failed to parse YAML front matter: ${(err as Error).message}`,
          err as Error
        );
      }

      const validationResult = WorkflowConfigSchema.safeParse(config);
      if (!validationResult.success) {
        warn('Workflow config validation warnings', {
          errors: validationResult.error.errors,
        });
      }

      promptTemplate = lines.slice(endIndex + 2).join('\n').trim();
    } else {
      promptTemplate = content.trim();
    }

    return { config, promptTemplate };
  }

  async startWatching(onReload: (def: WorkflowDefinition) => void): Promise<void> {
    this.onReload = onReload;

    try {
      const watcher = fs.watch(this.workflowPath);
      for await (const event of watcher) {
        if (event.eventType === 'change') {
          debug('Workflow file changed, reloading');
          try {
            const newDef = await this.load();
            this.onReload?.(newDef);
          } catch (err) {
            warn('Failed to reload workflow on file change', {
              error: (err as Error).message,
            });
          }
        }
      }
    } catch (err) {
      warn('Failed to watch workflow file', {
        error: (err as Error).message,
        path: this.workflowPath,
      });
    }
  }

  getCurrent(): WorkflowDefinition | null {
    return this.currentDefinition;
  }

  getPath(): string {
    return this.workflowPath;
  }

  async reload(): Promise<WorkflowDefinition> {
    const def = await this.load();
    this.onReload?.(def);
    return def;
  }
}
