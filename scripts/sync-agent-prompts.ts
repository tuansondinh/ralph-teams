import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

type CanonicalPrompt = {
  name: string;
  description: string;
  title: string;
  body: string;
};

type MarkdownBackend = {
  dir: string;
  models: Record<string, string>;
};

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const promptsDir = path.join(repoRoot, 'prompts', 'agents');

const markdownBackends: MarkdownBackend[] = [
  {
    dir: '.claude/agents',
    models: {
      'story-planner': 'haiku',
      'epic-planner': 'opus',
      builder: 'sonnet',
      'story-validator': 'sonnet',
      'epic-validator': 'sonnet',
      'final-validator': 'sonnet',
      merger: 'sonnet',
    },
  },
  {
    dir: '.github/agents',
    models: {
      'story-planner': 'gpt-5-mini',
      'epic-planner': 'gpt-5.3-codex',
      builder: 'gpt-5.3-codex',
      'story-validator': 'gpt-5.3-codex',
      'epic-validator': 'gpt-5.3-codex',
      'final-validator': 'gpt-5.3-codex',
      merger: 'gpt-5.3-codex',
    },
  },
  {
    dir: '.opencode/agents',
    models: {
      'story-planner': 'openai/gpt-5-mini',
      'epic-planner': 'openai/gpt-5.4',
      builder: 'openai/gpt-5.3-codex',
      'story-validator': 'openai/gpt-5.3-codex',
      'epic-validator': 'openai/gpt-5.3-codex',
      'final-validator': 'openai/gpt-5.3-codex',
      merger: 'openai/gpt-5.3-codex',
    },
  },
];

function parseCanonicalPrompt(filePath: string): CanonicalPrompt {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Missing frontmatter in ${filePath}`);
  }

  const frontmatter = yaml.load(match[1]) as Partial<CanonicalPrompt> | undefined;
  if (!frontmatter?.name || !frontmatter.description || !frontmatter.title) {
    throw new Error(`Incomplete frontmatter in ${filePath}`);
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    title: frontmatter.title,
    body: match[2].trimEnd(),
  };
}

function escapeTomlMultiline(value: string): string {
  return value.replace(/"""/g, '\\"""');
}

function renderMarkdownPrompt(prompt: CanonicalPrompt, model: string): string {
  return [
    '---',
    `name: ${prompt.name}`,
    `description: ${JSON.stringify(prompt.description)}`,
    `model: ${model}`,
    '---',
    '',
    '<!-- Generated from prompts/agents/*.md. Edit the canonical prompt, then run npm run sync:agents. -->',
    '',
    prompt.body,
    '',
  ].join('\n');
}

function renderCodexPrompt(prompt: CanonicalPrompt): string {
  return [
    '# Generated from prompts/agents/*.md. Edit the canonical prompt, then run npm run sync:agents.',
    `name = ${JSON.stringify(prompt.name)}`,
    `description = ${JSON.stringify(prompt.description)}`,
    'sandbox_mode = "workspace-write"',
    'developer_instructions = """',
    escapeTomlMultiline(prompt.body),
    '"""',
    '',
  ].join('\n');
}

function writeFileIfChanged(filePath: string, content: string): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (existing === content) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const canonicalPromptFiles = fs.readdirSync(promptsDir)
  .filter((file) => file.endsWith('.md'))
  .sort();

for (const fileName of canonicalPromptFiles) {
  const canonical = parseCanonicalPrompt(path.join(promptsDir, fileName));

  for (const backend of markdownBackends) {
    const suffix = backend.dir === '.github/agents' ? '.agent.md' : '.md';
    const outputPath = path.join(repoRoot, backend.dir, `${canonical.name}${suffix}`);
    const model = backend.models[canonical.name];
    if (!model) {
      throw new Error(`Missing model for ${canonical.name} in ${backend.dir}`);
    }
    writeFileIfChanged(outputPath, renderMarkdownPrompt(canonical, model));
  }

  const codexPath = path.join(repoRoot, '.codex/agents', `${canonical.name}.toml`);
  writeFileIfChanged(codexPath, renderCodexPrompt(canonical));
}
