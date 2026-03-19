/**
 * Platform Module
 * 
 * Exports the platform abstraction and factory for creating platform instances.
 */

export {
  // Types
  type Platform,
  type PlatformSession,
  type PlatformEvent,
  type PlatformEventType,
  type PlatformEventCallback,
  type PlatformQuestion,
  type QuestionOption,
  type CreateSessionOptions,
  type ResumeSessionOptions,
  type RunTurnOptions,
  type TurnResult,
  type PlatformConfig,
  type PlatformFactory,
  type PlatformRegistry,
  PlatformConfigSchema,
} from './types.js';

export { OpenCodePlatform } from './opencode-platform.js';
export { CodexPlatform } from './codex-platform.js';
export { CopilotPlatform } from './copilot-platform.js';

import { Platform, PlatformConfig, PlatformFactory } from './types.js';
import { OpenCodePlatform } from './opencode-platform.js';
import { CodexPlatform } from './codex-platform.js';
import { CopilotPlatform } from './copilot-platform.js';
import { Logger } from '../logger.js';

const log = new Logger('platform-registry');

// ============================================================================
// Platform Registry Implementation
// ============================================================================

const platformFactories: Map<string, PlatformFactory> = new Map();

/**
 * Register a platform factory.
 */
export function registerPlatform(name: string, factory: PlatformFactory): void {
  if (platformFactories.has(name)) {
    log.warn('Overwriting existing platform factory', { name });
  }
  platformFactories.set(name, factory);
  log.debug('Registered platform factory', { name });
}

/**
 * Create a platform instance based on configuration.
 */
export function createPlatform(config: PlatformConfig): Platform {
  const platformType = config.type ?? 'opencode';
  
  const factory = platformFactories.get(platformType);
  if (!factory) {
    const available = getAvailablePlatforms();
    throw new Error(
      `Unknown platform type: ${platformType}. Available platforms: ${available.join(', ')}`
    );
  }
  
  log.info('Creating platform instance', { type: platformType });
  return factory(config);
}

/**
 * Get list of available platform types.
 */
export function getAvailablePlatforms(): string[] {
  return Array.from(platformFactories.keys());
}

// ============================================================================
// Register Built-in Platforms
// ============================================================================

registerPlatform('opencode', (config: PlatformConfig) => new OpenCodePlatform(config));
registerPlatform('codex', (config: PlatformConfig) => new CodexPlatform(config));
registerPlatform('copilot', (config: PlatformConfig) => new CopilotPlatform(config));
