import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StoredWorkflow, WorkflowConfig } from './types.js';
import { ServiceConfig } from './config.js';
import { Logger } from './logger.js';
import { findClosestMatchMultiKey } from './string-similarity.js';

const log = new Logger('workflow-store');

interface LocalWorkflowData {
  id: string;
  name: string;
  description?: string | null;
  template_file: string;
  config: WorkflowConfig;
  is_default?: boolean;
  max_concurrent_agents?: number;
  created_at?: string;
  updated_at?: string;
}

interface WorkflowsFile {
  workflows: LocalWorkflowData[];
}

export class WorkflowStore {
  private workflowsDir: string;
  private privateWorkflowsDir: string | null = null;
  private cachedWorkflows: StoredWorkflow[] | null = null;

  constructor(config: ServiceConfig) {
    this.workflowsDir = config.workflowsDir;
  }

  updateConfig(config: ServiceConfig): void {
    if (config.workflowsDir !== this.workflowsDir) {
      this.workflowsDir = config.workflowsDir;
      this.cachedWorkflows = null;
    }
  }

  setPrivateWorkflowsDir(dir: string | null): void {
    if (dir !== this.privateWorkflowsDir) {
      this.privateWorkflowsDir = dir;
      this.cachedWorkflows = null;
      log.debug('Private workflows directory updated', { dir });
    }
  }

  getPrivateWorkflowsDir(): string | null {
    return this.privateWorkflowsDir;
  }

  private get jsonPath(): string {
    return path.join(this.workflowsDir, 'workflows.json');
  }

  private async ensureWorkflowsDir(): Promise<void> {
    await fs.mkdir(this.workflowsDir, { recursive: true });
  }

  private generateId(name: string): string {
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || `workflow-${Date.now()}`;
  }

  private getTemplatePath(templateFile: string): string {
    return path.join(this.workflowsDir, templateFile);
  }

  private async readTemplate(templateFile: string): Promise<string> {
    const templatePath = this.getTemplatePath(templateFile);
    try {
      return await fs.readFile(templatePath, 'utf-8');
    } catch (err) {
      log.warn('Failed to read template file', { templateFile, error: (err as Error).message });
      return '';
    }
  }

  private async writeTemplate(templateFile: string, content: string): Promise<void> {
    const templatePath = this.getTemplatePath(templateFile);
    await fs.writeFile(templatePath, content, 'utf-8');
  }

  private async deleteTemplate(templateFile: string): Promise<void> {
    const templatePath = this.getTemplatePath(templateFile);
    try {
      await fs.unlink(templatePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private async loadWorkflowsJson(): Promise<LocalWorkflowData[]> {
    try {
      const content = await fs.readFile(this.jsonPath, 'utf-8');
      const data: WorkflowsFile = JSON.parse(content);
      return data.workflows || [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  private async saveWorkflowsJson(workflows: LocalWorkflowData[]): Promise<void> {
    await this.ensureWorkflowsDir();
    const data: WorkflowsFile = { workflows };
    await fs.writeFile(this.jsonPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async loadWorkflowsFromDir(
    dir: string,
    isPrivate: boolean
  ): Promise<StoredWorkflow[]> {
    const jsonPath = path.join(dir, 'workflows.json');
    let workflowsData: LocalWorkflowData[] = [];

    try {
      const content = await fs.readFile(jsonPath, 'utf-8');
      const data: WorkflowsFile = JSON.parse(content);
      workflowsData = data.workflows || [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read workflows.json', { dir, error: (err as Error).message });
      }
      return [];
    }

    const workflows: StoredWorkflow[] = [];

    for (const data of workflowsData) {
      const templatePath = path.join(dir, data.template_file);
      let promptTemplate = '';
      try {
        promptTemplate = await fs.readFile(templatePath, 'utf-8');
      } catch (err) {
        log.warn('Failed to read template file', { 
          templateFile: data.template_file, 
          dir,
          error: (err as Error).message 
        });
      }

      workflows.push({
        id: data.id,
        name: data.name,
        description: data.description ?? null,
        promptTemplate,
        config: data.config ?? {},
        isDefault: isPrivate ? false : (data.is_default ?? false), // Private workflows can't be default
        isPrivate,
        maxConcurrentAgents: data.max_concurrent_agents ?? 1,
        createdAt: data.created_at ? new Date(data.created_at) : new Date(),
        updatedAt: data.updated_at ? new Date(data.updated_at) : new Date(),
      });
    }

    return workflows;
  }

  private async loadWorkflows(): Promise<StoredWorkflow[]> {
    if (this.cachedWorkflows) {
      return this.cachedWorkflows;
    }

    // Load regular workflows
    const regularWorkflows = await this.loadWorkflowsFromDir(this.workflowsDir, false);
    
    // Load private workflows if configured
    let privateWorkflows: StoredWorkflow[] = [];
    if (this.privateWorkflowsDir) {
      privateWorkflows = await this.loadWorkflowsFromDir(this.privateWorkflowsDir, true);
      
      // Prefix private workflow IDs to avoid collisions
      for (const workflow of privateWorkflows) {
        if (regularWorkflows.some(w => w.id === workflow.id)) {
          workflow.id = `private-${workflow.id}`;
        }
      }
      
      log.debug('Loaded private workflows', { 
        count: privateWorkflows.length, 
        dir: this.privateWorkflowsDir 
      });
    }

    const workflows = [...regularWorkflows, ...privateWorkflows];
    
    if (workflows.length === 0) {
      log.debug('No workflows found', { dir: this.workflowsDir });
    } else {
      log.info('Loaded workflows', { 
        total: workflows.length,
        regular: regularWorkflows.length,
        private: privateWorkflows.length 
      });
    }

    this.cachedWorkflows = workflows;
    return workflows;
  }

  async listWorkflows(): Promise<StoredWorkflow[]> {
    return this.loadWorkflows();
  }

  async getWorkflow(id: string): Promise<StoredWorkflow | null> {
    const workflows = await this.loadWorkflows();
    return workflows.find(w => w.id === id) ?? null;
  }

  /**
   * Find a workflow by name with fuzzy matching.
   * Tries exact match first, then case-insensitive, then partial match.
   * Returns the workflow, available workflows, and closest match for error messages.
   */
  async findWorkflowByNameOrId(nameOrId: string): Promise<{
    workflow: StoredWorkflow | null;
    availableWorkflows: Array<{ id: string; name: string }>;
    closestMatch: { id: string; name: string; similarity: number } | null;
  }> {
    const workflows = await this.loadWorkflows();
    const availableWorkflows = workflows.map(w => ({ id: w.id, name: w.name }));

    // 1. Exact ID match
    let workflow = workflows.find(w => w.id === nameOrId);
    if (workflow) {
      return { workflow, availableWorkflows, closestMatch: null };
    }

    // 2. Exact name match (case-sensitive)
    workflow = workflows.find(w => w.name === nameOrId);
    if (workflow) {
      return { workflow, availableWorkflows, closestMatch: null };
    }

    // 3. Case-insensitive name match
    const lowerNameOrId = nameOrId.toLowerCase();
    workflow = workflows.find(w => w.name.toLowerCase() === lowerNameOrId);
    if (workflow) {
      return { workflow, availableWorkflows, closestMatch: null };
    }

    // 4. Case-insensitive ID match
    workflow = workflows.find(w => w.id.toLowerCase() === lowerNameOrId);
    if (workflow) {
      return { workflow, availableWorkflows, closestMatch: null };
    }

    // 5. Partial name match (name contains search term)
    workflow = workflows.find(w => w.name.toLowerCase().includes(lowerNameOrId));
    if (workflow) {
      return { workflow, availableWorkflows, closestMatch: null };
    }

    // 6. Partial ID match (ID contains search term)
    workflow = workflows.find(w => w.id.toLowerCase().includes(lowerNameOrId));
    if (workflow) {
      return { workflow, availableWorkflows, closestMatch: null };
    }

    // 7. Check if search term contains workflow name/ID (reverse partial match)
    workflow = workflows.find(w => 
      lowerNameOrId.includes(w.name.toLowerCase()) || 
      lowerNameOrId.includes(w.id.toLowerCase())
    );
    if (workflow) {
      return { workflow, availableWorkflows, closestMatch: null };
    }

    // 8. No match found - compute closest match using Levenshtein distance
    const match = findClosestMatchMultiKey(
      nameOrId,
      workflows,
      (w) => [w.id, w.name]
    );

    const closestMatch = match
      ? { id: match.item.id, name: match.item.name, similarity: match.similarity }
      : null;

    return { workflow: null, availableWorkflows, closestMatch };
  }

  async getWorkflowFresh(id: string): Promise<StoredWorkflow | null> {
    const workflowsData = await this.loadWorkflowsJson();
    const data = workflowsData.find(w => w.id === id);
    if (!data) return null;
    
    const promptTemplate = await this.readTemplate(data.template_file);
    return {
      id: data.id,
      name: data.name,
      description: data.description ?? null,
      promptTemplate,
      config: data.config ?? {},
      isDefault: data.is_default ?? false,
      isPrivate: false,
      maxConcurrentAgents: data.max_concurrent_agents ?? 1,
      createdAt: data.created_at ? new Date(data.created_at) : new Date(),
      updatedAt: data.updated_at ? new Date(data.updated_at) : new Date(),
    };
  }

  async getDefaultWorkflow(): Promise<StoredWorkflow | null> {
    const workflows = await this.loadWorkflows();
    return workflows.find(w => w.isDefault) ?? workflows[0] ?? null;
  }

  async createWorkflow(data: {
    name: string;
    description?: string | null;
    promptTemplate: string;
    config?: WorkflowConfig;
    isDefault?: boolean;
    maxConcurrentAgents?: number;
  }): Promise<StoredWorkflow> {
    await this.ensureWorkflowsDir();
    
    let id = this.generateId(data.name);
    const workflowsData = await this.loadWorkflowsJson();
    
    if (workflowsData.some(w => w.id === id)) {
      id = `${id}-${Date.now()}`;
    }

    const templateFile = `${id}.md`;
    const now = new Date();

    if (data.isDefault) {
      for (const w of workflowsData) {
        w.is_default = false;
      }
    }

    const newWorkflow: LocalWorkflowData = {
      id,
      name: data.name,
      description: data.description ?? null,
      template_file: templateFile,
      config: data.config ?? {},
      is_default: data.isDefault ?? false,
      max_concurrent_agents: data.maxConcurrentAgents ?? 1,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    workflowsData.push(newWorkflow);
    
    await this.writeTemplate(templateFile, data.promptTemplate);
    await this.saveWorkflowsJson(workflowsData);
    
    this.cachedWorkflows = null;

    log.info('Created workflow', { id, name: data.name });
    
    return {
      id,
      name: data.name,
      description: data.description ?? null,
      promptTemplate: data.promptTemplate,
      config: data.config ?? {},
      isDefault: data.isDefault ?? false,
      isPrivate: false,
      maxConcurrentAgents: data.maxConcurrentAgents ?? 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateWorkflow(id: string, updates: Partial<{
    name: string;
    description: string | null;
    promptTemplate: string;
    config: WorkflowConfig;
    isDefault: boolean;
    maxConcurrentAgents: number;
  }>): Promise<StoredWorkflow | null> {
    const workflowsData = await this.loadWorkflowsJson();
    const index = workflowsData.findIndex(w => w.id === id);

    if (index === -1) {
      return null;
    }

    const workflowData = workflowsData[index];

    if (updates.isDefault) {
      for (const w of workflowsData) {
        w.is_default = false;
      }
    }

    if (updates.name !== undefined) workflowData.name = updates.name;
    if (updates.description !== undefined) workflowData.description = updates.description;
    if (updates.config !== undefined) workflowData.config = updates.config;
    if (updates.isDefault !== undefined) workflowData.is_default = updates.isDefault;
    if (updates.maxConcurrentAgents !== undefined) workflowData.max_concurrent_agents = updates.maxConcurrentAgents;
    workflowData.updated_at = new Date().toISOString();

    if (updates.promptTemplate !== undefined) {
      await this.writeTemplate(workflowData.template_file, updates.promptTemplate);
    }

    await this.saveWorkflowsJson(workflowsData);
    this.cachedWorkflows = null;

    const promptTemplate = updates.promptTemplate ?? await this.readTemplate(workflowData.template_file);

    log.info('Updated workflow', { id, name: workflowData.name });

    return {
      id: workflowData.id,
      name: workflowData.name,
      description: workflowData.description ?? null,
      promptTemplate,
      config: workflowData.config ?? {},
      isDefault: workflowData.is_default ?? false,
      isPrivate: false,
      maxConcurrentAgents: workflowData.max_concurrent_agents ?? 1,
      createdAt: workflowData.created_at ? new Date(workflowData.created_at) : new Date(),
      updatedAt: new Date(workflowData.updated_at!),
    };
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const workflowsData = await this.loadWorkflowsJson();
    const index = workflowsData.findIndex(w => w.id === id);

    if (index === -1) {
      return false;
    }

    const deleted = workflowsData.splice(index, 1)[0];

    if (deleted.is_default && workflowsData.length > 0) {
      workflowsData[0].is_default = true;
    }

    await this.deleteTemplate(deleted.template_file);
    await this.saveWorkflowsJson(workflowsData);
    this.cachedWorkflows = null;

    log.info('Deleted workflow', { id, name: deleted.name });
    return true;
  }

  async initializeFromWorkflowMd(promptTemplate: string, config: WorkflowConfig): Promise<StoredWorkflow> {
    const workflows = await this.loadWorkflows();

    if (workflows.length > 0) {
      log.debug('Workflows already exist, skipping initialization');
      return workflows.find(w => w.isDefault) ?? workflows[0];
    }

    const maxConcurrentAgents = typeof config.agent?.max_concurrent_agents === 'number' 
      ? config.agent.max_concurrent_agents 
      : 1;

    const defaultWorkflow = await this.createWorkflow({
      name: 'Default Workflow',
      description: 'Default workflow imported from WORKFLOW.md',
      promptTemplate,
      config,
      isDefault: true,
      maxConcurrentAgents,
    });

    log.info('Initialized default workflow from WORKFLOW.md');
    return defaultWorkflow;
  }
}
