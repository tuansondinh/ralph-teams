import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/** Runtime configuration for ralph-teams. */
export interface RalphConfig {
  timeouts: {
    /** Max seconds before an epic run is forcibly stopped. Default: 3600. */
    epicTimeout: number;
    /** Max idle seconds before an epic agent is considered hung. Default: 600. */
    idleTimeout: number;
  };
  execution: {
    /** Maximum validator pushback cycles per story. Default: 1. */
    validatorMaxPushbacks: number;
    /** Max epics to run in parallel (0 = unlimited). Default: 0. */
    parallel: number;
    /** AI backend to use: 'claude', 'copilot', or 'codex'. Default: 'claude'. */
    backend: string;
  };
  agents: {
    /** Model for the team-lead agent. Default: 'opus'. */
    teamLead: string;
    /** Model for the planner agent. Default: 'opus'. */
    planner: string;
    /** Model for the builder agent. Default: 'sonnet'. */
    builder: string;
    /** Model for the validator agent. Default: 'sonnet'. */
    validator: string;
    /** Model for the merger agent. Default: 'sonnet'. */
    merger: string;
  };
  pricing: {
    /** USD cost per 1k input tokens. Default: 0.015 (Claude Sonnet). */
    inputTokenCostPer1k: number;
    /** USD cost per 1k output tokens. Default: 0.075 (Claude Sonnet). */
    outputTokenCostPer1k: number;
    /** USD cost per 1k cache read tokens. Default: 0.0015. */
    cacheReadCostPer1k: number;
    /** USD cost per 1k cache creation tokens. Default: 0.01875. */
    cacheCreationCostPer1k: number;
  };
}

export type AgentModelField = keyof RalphConfig['agents'];

const VALID_MODELS = ['opus', 'sonnet', 'haiku'] as const;

/** Default configuration values used when no ralph.config.yml is present. */
export const DEFAULT_CONFIG: RalphConfig = {
  timeouts: {
    epicTimeout: 3600,
    idleTimeout: 600,
  },
  execution: {
    validatorMaxPushbacks: 1,
    parallel: 0,
    backend: 'claude',
  },
  agents: {
    teamLead: 'opus',
    planner: 'opus',
    builder: 'sonnet',
    validator: 'sonnet',
    merger: 'sonnet',
  },
  pricing: {
    inputTokenCostPer1k: 0.015,
    outputTokenCostPer1k: 0.075,
    cacheReadCostPer1k: 0.0015,
    cacheCreationCostPer1k: 0.01875,
  },
};

function cloneConfig(config: RalphConfig): RalphConfig {
  return {
    timeouts: { ...config.timeouts },
    execution: { ...config.execution },
    agents: { ...config.agents },
    pricing: { ...config.pricing },
  };
}

export function renderConfigYaml(config: RalphConfig = DEFAULT_CONFIG): string {
  return `${yaml.dump(config, { noRefs: true, lineWidth: -1 }).trimEnd()}\n`;
}

export function renderCommentedConfigTemplate(config: RalphConfig = DEFAULT_CONFIG): string {
  const header = [
    '# Ralph Teams configuration',
    '# Uncomment and edit values as needed.',
    '# A fully commented or empty file means "use built-in defaults".',
    '#',
  ];

  const commentedBody = renderConfigYaml(config)
    .trimEnd()
    .split('\n')
    .map(line => `# ${line}`);

  return `${[...header, ...commentedBody].join('\n')}\n`;
}

/**
 * Validates a raw parsed YAML object against the RalphConfig schema.
 * Returns the validated config (with defaults for missing fields) and a list
 * of descriptive error strings for any invalid or out-of-range fields.
 */
export function validateConfig(raw: unknown): { config: RalphConfig; errors: string[] } {
  const errors: string[] = [];

  // Start from defaults so partial configs inherit missing values
  const config: RalphConfig = {
    timeouts: { ...DEFAULT_CONFIG.timeouts },
    execution: { ...DEFAULT_CONFIG.execution },
    agents: { ...DEFAULT_CONFIG.agents },
    pricing: { ...DEFAULT_CONFIG.pricing },
  };

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('Config file must be a YAML object, got ' + (Array.isArray(raw) ? 'array' : String(raw)));
    return { config, errors };
  }

  const obj = raw as Record<string, unknown>;

  // --- timeouts ---
  if ('timeouts' in obj) {
    const timeouts = obj['timeouts'];
    if (timeouts === null || typeof timeouts !== 'object' || Array.isArray(timeouts)) {
      errors.push('timeouts must be an object');
    } else {
      const t = timeouts as Record<string, unknown>;

      if ('epicTimeout' in t) {
        const v = t['epicTimeout'];
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          errors.push(`timeouts.epicTimeout must be a positive number, got '${v}'`);
        } else {
          config.timeouts.epicTimeout = v;
        }
      }

      if ('idleTimeout' in t) {
        const v = t['idleTimeout'];
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          errors.push(`timeouts.idleTimeout must be a positive number, got '${v}'`);
        } else {
          config.timeouts.idleTimeout = v;
        }
      }
    }
  }

  // --- execution ---
  if ('execution' in obj) {
    const execution = obj['execution'];
    if (execution === null || typeof execution !== 'object' || Array.isArray(execution)) {
      errors.push('execution must be an object');
    } else {
      const e = execution as Record<string, unknown>;

      if ('validatorMaxPushbacks' in e) {
        const v = e['validatorMaxPushbacks'];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          errors.push(`execution.validatorMaxPushbacks must be a non-negative integer, got '${v}'`);
        } else {
          config.execution.validatorMaxPushbacks = v;
        }
      }

      if ('parallel' in e) {
        const v = e['parallel'];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          errors.push(`execution.parallel must be a non-negative integer, got '${v}'`);
        } else {
          config.execution.parallel = v;
        }
      }

      if ('backend' in e) {
        const v = e['backend'];
        if (v !== 'claude' && v !== 'copilot' && v !== 'codex') {
          errors.push(`execution.backend must be 'claude', 'copilot', or 'codex', got '${v}'`);
        } else {
          config.execution.backend = v;
        }
      }
    }
  }

  // --- agents ---
  if ('agents' in obj) {
    const agents = obj['agents'];
    if (agents === null || typeof agents !== 'object' || Array.isArray(agents)) {
      errors.push('agents must be an object');
    } else {
      const a = agents as Record<string, unknown>;
      const agentFields = ['teamLead', 'planner', 'builder', 'validator', 'merger'] as const;
      for (const field of agentFields) {
        if (field in a) {
          const v = a[field];
          if (!VALID_MODELS.includes(v as typeof VALID_MODELS[number])) {
            errors.push(`agents.${field} must be 'opus', 'sonnet', or 'haiku', got '${v}'`);
          } else {
            config.agents[field] = v as string;
          }
        }
      }
    }
  }

  // --- pricing ---
  if ('pricing' in obj) {
    const pricing = obj['pricing'];
    if (pricing === null || typeof pricing !== 'object' || Array.isArray(pricing)) {
      errors.push('pricing must be an object');
    } else {
      const p = pricing as Record<string, unknown>;

      const pricingFields = [
        'inputTokenCostPer1k',
        'outputTokenCostPer1k',
        'cacheReadCostPer1k',
        'cacheCreationCostPer1k',
      ] as const;

      for (const field of pricingFields) {
        if (field in p) {
          const v = p[field];
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            errors.push(`pricing.${field} must be a non-negative number, got '${v}'`);
          } else {
            config.pricing[field] = v;
          }
        }
      }
    }
  }

  return { config, errors };
}

/**
 * Loads ralph.config.yml from the given project root directory.
 * If no config file is found, returns DEFAULT_CONFIG.
 * If the file is found but contains invalid YAML or invalid field values,
 * throws an Error with a descriptive message.
 *
 * @param projectRoot - Absolute path to the directory containing ralph.config.yml
 */
export function loadConfig(projectRoot: string): RalphConfig {
  const configPath = path.join(projectRoot, 'ralph.config.yml');

  if (!fs.existsSync(configPath)) {
    return cloneConfig(DEFAULT_CONFIG);
  }

  const contents = fs.readFileSync(configPath, 'utf-8');
  if (contents.trim() === '') {
    return cloneConfig(DEFAULT_CONFIG);
  }

  let raw: unknown;
  try {
    raw = yaml.load(contents);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid YAML in ralph.config.yml: ${msg}`);
  }

  if (raw == null) {
    return cloneConfig(DEFAULT_CONFIG);
  }

  const { config, errors } = validateConfig(raw);

  if (errors.length > 0) {
    throw new Error(`Invalid ralph.config.yml:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  return config;
}

/**
 * Merges CLI flag overrides on top of a loaded config.
 * CLI flags always take precedence. Only defined (non-undefined) overrides are applied.
 *
 * @param config - Base config (from loadConfig)
 * @param overrides - Partial overrides from CLI flags
 */
export function mergeCliOverrides(
  config: RalphConfig,
  overrides: Partial<{ backend: string; parallel: number }>,
): RalphConfig {
  return {
    timeouts: { ...config.timeouts },
    execution: {
      ...config.execution,
      ...(overrides.backend !== undefined ? { backend: overrides.backend } : {}),
      ...(overrides.parallel !== undefined ? { parallel: overrides.parallel } : {}),
    },
    agents: { ...config.agents },
    pricing: { ...config.pricing },
  };
}

export function loadExplicitAgentModelOverrides(projectRoot: string): Partial<Record<AgentModelField, string>> {
  const configPath = path.join(projectRoot, 'ralph.config.yml');

  if (!fs.existsSync(configPath)) {
    return {};
  }

  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(configPath, 'utf-8'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid YAML in ralph.config.yml: ${msg}`);
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const agents = (raw as Record<string, unknown>)['agents'];
  if (agents === null || typeof agents !== 'object' || Array.isArray(agents)) {
    return {};
  }

  const explicit: Partial<Record<AgentModelField, string>> = {};
  const agentObj = agents as Record<string, unknown>;
  const fields: AgentModelField[] = ['teamLead', 'planner', 'builder', 'validator', 'merger'];

  for (const field of fields) {
    const value = agentObj[field];
    if (typeof value === 'string') {
      explicit[field] = value;
    }
  }

  return explicit;
}
