import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export type WorkflowPreset = 'balanced' | 'full' | 'minimal';

type ToggleConfig = {
  enabled: boolean;
};

type ToggleWithFixCyclesConfig = ToggleConfig & {
  maxFixCycles: number;
};

/** Runtime configuration for ralph-teams. */
export interface RalphConfig {
  workflow: {
    /** High-level preset for planning/validation toggles. Default: 'balanced'. */
    preset: WorkflowPreset;
  };
  timeouts: {
    /** Max seconds before an epic run is forcibly stopped. Default: 3600. */
    epicTimeout: number;
    /** Max idle seconds before an epic agent is considered hung. Default: 600. */
    idleTimeout: number;
    /** Max seconds before the overall Ralph run is forcibly stopped. 0 disables it. Default: 18000. */
    loopTimeout: number;
  };
  execution: {
    /** Max epics to run in parallel (0 = unlimited). Default: 0. */
    parallel: number;
    /** AI backend to use: 'claude', 'copilot', or 'codex'. Default: 'claude'. */
    backend: string;
    /** Whether per-story planning is enabled. */
    storyPlanning: ToggleConfig;
    /** Whether per-story validation is enabled and how many fix cycles are allowed. */
    storyValidation: ToggleWithFixCyclesConfig;
    /** Whether epic-level planning is enabled. */
    epicPlanning: ToggleConfig;
    /** Whether epic-level validation is enabled and how many fix cycles are allowed. */
    epicValidation: ToggleWithFixCyclesConfig;
    /** Whether final whole-run validation is enabled and how many fix cycles are allowed. */
    finalValidation: ToggleWithFixCyclesConfig;
  };
  agents: {
    /** Model for the team-lead agent. Default: 'opus'. */
    teamLead: string;
    /** Model for the story planner agent. Default: 'opus'. */
    storyPlanner: string;
    /** Model for the epic planner agent. Default: 'opus'. */
    epicPlanner: string;
    /** Model for the builder agent. Default: 'sonnet'. */
    builder: string;
    /** Model for the story validator agent. Default: 'sonnet'. */
    storyValidator: string;
    /** Model for the epic validator agent. Default: 'opus'. */
    epicValidator: string;
    /** Model for the final validator agent. Default: 'opus'. */
    finalValidator: string;
    /** Model for the merger agent. Default: 'sonnet'. */
    merger: string;
  };
}

export type AgentModelField = keyof RalphConfig['agents'];

const VALID_PRESETS = ['balanced', 'full', 'minimal'] as const;

function parseAgentModel(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function presetExecution(preset: WorkflowPreset): RalphConfig['execution'] {
  switch (preset) {
    case 'full':
      return {
        parallel: 0,
        backend: 'claude',
        storyPlanning: { enabled: true },
        storyValidation: { enabled: true, maxFixCycles: 1 },
        epicPlanning: { enabled: true },
        epicValidation: { enabled: true, maxFixCycles: 1 },
        finalValidation: { enabled: true, maxFixCycles: 1 },
      };
    case 'minimal':
      return {
        parallel: 0,
        backend: 'claude',
        storyPlanning: { enabled: false },
        storyValidation: { enabled: false, maxFixCycles: 1 },
        epicPlanning: { enabled: false },
        epicValidation: { enabled: false, maxFixCycles: 1 },
        finalValidation: { enabled: false, maxFixCycles: 1 },
      };
    case 'balanced':
    default:
      return {
        parallel: 0,
        backend: 'claude',
        storyPlanning: { enabled: false },
        storyValidation: { enabled: false, maxFixCycles: 1 },
        epicPlanning: { enabled: true },
        epicValidation: { enabled: true, maxFixCycles: 1 },
        finalValidation: { enabled: false, maxFixCycles: 1 },
      };
  }
}

/** Default configuration values used when no ralph.config.yml is present. */
export const DEFAULT_CONFIG: RalphConfig = {
  workflow: {
    preset: 'balanced',
  },
  timeouts: {
    epicTimeout: 3600,
    idleTimeout: 600,
    loopTimeout: 18000,
  },
  execution: presetExecution('balanced'),
  agents: {
    teamLead: 'opus',
    storyPlanner: 'opus',
    epicPlanner: 'opus',
    builder: 'sonnet',
    storyValidator: 'sonnet',
    epicValidator: 'opus',
    finalValidator: 'opus',
    merger: 'sonnet',
  },
};

function cloneConfig(config: RalphConfig): RalphConfig {
  return {
    workflow: { ...config.workflow },
    timeouts: { ...config.timeouts },
    execution: {
      parallel: config.execution.parallel,
      backend: config.execution.backend,
      storyPlanning: { ...config.execution.storyPlanning },
      storyValidation: { ...config.execution.storyValidation },
      epicPlanning: { ...config.execution.epicPlanning },
      epicValidation: { ...config.execution.epicValidation },
      finalValidation: { ...config.execution.finalValidation },
    },
    agents: { ...config.agents },
  };
}

function parseBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function applyPreset(config: RalphConfig, preset: WorkflowPreset): void {
  const execution = presetExecution(preset);
  config.workflow.preset = preset;
  config.execution.parallel = execution.parallel;
  config.execution.backend = execution.backend;
  config.execution.storyPlanning = { ...execution.storyPlanning };
  config.execution.storyValidation = { ...execution.storyValidation };
  config.execution.epicPlanning = { ...execution.epicPlanning };
  config.execution.epicValidation = { ...execution.epicValidation };
  config.execution.finalValidation = { ...execution.finalValidation };
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
  const templateConfig = {
    workflow: config.workflow,
    timeouts: config.timeouts,
    execution: config.execution,
    agents: config.agents,
  };

  const commentedBody = `${yaml.dump(templateConfig, { noRefs: true, lineWidth: -1 }).trimEnd()}\n`
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

  const config = cloneConfig(DEFAULT_CONFIG);

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('Config file must be a YAML object, got ' + (Array.isArray(raw) ? 'array' : String(raw)));
    return { config, errors };
  }

  const obj = raw as Record<string, unknown>;

  if ('workflow' in obj) {
    const workflow = obj['workflow'];
    if (workflow === null || typeof workflow !== 'object' || Array.isArray(workflow)) {
      errors.push('workflow must be an object');
    } else {
      const w = workflow as Record<string, unknown>;
      if ('preset' in w) {
        const v = w['preset'];
        const normalizedPreset = v === 'default' || v === 'epic-focused'
          ? 'balanced'
          : v === 'thorough'
            ? 'full'
            : v === 'off'
              ? 'minimal'
              : v;
        if (!VALID_PRESETS.includes(normalizedPreset as WorkflowPreset)) {
          errors.push(`workflow.preset must be 'balanced', 'full', or 'minimal' (legacy 'epic-focused', 'default', 'thorough', and 'off' also accepted), got '${v}'`);
        } else {
          applyPreset(config, normalizedPreset as WorkflowPreset);
        }
      }
    }
  }

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

      if ('loopTimeout' in t) {
        const v = t['loopTimeout'];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          errors.push(`timeouts.loopTimeout must be a non-negative number, got '${v}'`);
        } else {
          config.timeouts.loopTimeout = v;
        }
      }
    }
  }

  if ('execution' in obj) {
    const execution = obj['execution'];
    if (execution === null || typeof execution !== 'object' || Array.isArray(execution)) {
      errors.push('execution must be an object');
    } else {
      const e = execution as Record<string, unknown>;

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
        if (v !== 'claude' && v !== 'copilot' && v !== 'codex' && v !== 'opencode') {
          errors.push(`execution.backend must be 'claude', 'copilot', 'codex', or 'opencode', got '${v}'`);
        } else {
          config.execution.backend = v;
        }
      }

      const legacyPushbacks = 'validatorMaxPushbacks' in e ? parseNonNegativeInteger(e['validatorMaxPushbacks']) : null;
      if ('validatorMaxPushbacks' in e && legacyPushbacks === null) {
        errors.push(`execution.validatorMaxPushbacks must be a non-negative integer, got '${e['validatorMaxPushbacks']}'`);
      }
      if (legacyPushbacks !== null && !('storyValidation' in e)) {
        config.execution.storyValidation.maxFixCycles = legacyPushbacks;
      }

      const booleanToggles = [
        ['storyPlanning', config.execution.storyPlanning],
        ['epicPlanning', config.execution.epicPlanning],
      ] as const;
      for (const [field, target] of booleanToggles) {
        if (field in e) {
          const rawToggle = e[field];
          if (rawToggle === null || typeof rawToggle !== 'object' || Array.isArray(rawToggle)) {
            errors.push(`execution.${field} must be an object`);
            continue;
          }
          const enabled = parseBoolean((rawToggle as Record<string, unknown>)['enabled']);
          if (enabled === null) {
            errors.push(`execution.${field}.enabled must be a boolean`);
          } else {
            target.enabled = enabled;
          }
        }
      }

      const validationToggles = [
        ['storyValidation', config.execution.storyValidation],
        ['epicValidation', config.execution.epicValidation],
        ['finalValidation', config.execution.finalValidation],
      ] as const;

      for (const [field, target] of validationToggles) {
        if (field in e) {
          const rawToggle = e[field];
          if (rawToggle === null || typeof rawToggle !== 'object' || Array.isArray(rawToggle)) {
            errors.push(`execution.${field} must be an object`);
            continue;
          }
          const toggle = rawToggle as Record<string, unknown>;
          const enabled = parseBoolean(toggle['enabled']);
          if (enabled === null) {
            errors.push(`execution.${field}.enabled must be a boolean`);
          } else {
            target.enabled = enabled;
          }
          if ('maxFixCycles' in toggle) {
            const maxFixCycles = parseNonNegativeInteger(toggle['maxFixCycles']);
            if (maxFixCycles === null) {
              errors.push(`execution.${field}.maxFixCycles must be a non-negative integer, got '${toggle['maxFixCycles']}'`);
            } else {
              target.maxFixCycles = maxFixCycles;
            }
          }
        }
      }
    }
  }

  if ('agents' in obj) {
    const agents = obj['agents'];
    if (agents === null || typeof agents !== 'object' || Array.isArray(agents)) {
      errors.push('agents must be an object');
    } else {
      const a = agents as Record<string, unknown>;
      const agentFields: AgentModelField[] = [
        'teamLead',
        'storyPlanner',
        'epicPlanner',
        'builder',
        'storyValidator',
        'epicValidator',
        'finalValidator',
        'merger',
      ];
      for (const field of agentFields) {
        if (field in a) {
          const parsed = parseAgentModel(a[field]);
          if (parsed === null) {
            errors.push(`agents.${field} must be a non-empty string, got '${a[field]}'`);
          } else {
            config.agents[field] = parsed;
          }
        }
      }

      if ('planner' in a && !('epicPlanner' in a)) {
        const parsed = parseAgentModel(a['planner']);
        if (parsed === null) {
          errors.push(`agents.planner must be a non-empty string, got '${a['planner']}'`);
        } else {
          config.agents.epicPlanner = parsed;
        }
      }

      if ('validator' in a && !('storyValidator' in a)) {
        const parsed = parseAgentModel(a['validator']);
        if (parsed === null) {
          errors.push(`agents.validator must be a non-empty string, got '${a['validator']}'`);
        } else {
          config.agents.storyValidator = parsed;
        }
      }
    }
  }

  return { config, errors };
}

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

export function mergeCliOverrides(
  config: RalphConfig,
  overrides: Partial<{ backend: string; parallel: number }>,
): RalphConfig {
  return {
    workflow: { ...config.workflow },
    timeouts: { ...config.timeouts },
    execution: {
      parallel: overrides.parallel !== undefined ? overrides.parallel : config.execution.parallel,
      backend: overrides.backend !== undefined ? overrides.backend : config.execution.backend,
      storyPlanning: { ...config.execution.storyPlanning },
      storyValidation: { ...config.execution.storyValidation },
      epicPlanning: { ...config.execution.epicPlanning },
      epicValidation: { ...config.execution.epicValidation },
      finalValidation: { ...config.execution.finalValidation },
    },
    agents: { ...config.agents },
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

  const agentObj = agents as Record<string, unknown>;
  const explicit: Partial<Record<AgentModelField, string>> = {};

  const directFields: AgentModelField[] = [
    'teamLead',
    'storyPlanner',
    'epicPlanner',
    'builder',
    'storyValidator',
    'epicValidator',
    'finalValidator',
    'merger',
  ];

  for (const field of directFields) {
    const value = agentObj[field];
    if (typeof value === 'string') {
      explicit[field] = value;
    }
  }

  if (explicit.epicPlanner === undefined && typeof agentObj['planner'] === 'string') {
    explicit.epicPlanner = agentObj['planner'];
  }
  if (explicit.storyValidator === undefined && typeof agentObj['validator'] === 'string') {
    explicit.storyValidator = agentObj['validator'];
  }

  return explicit;
}
