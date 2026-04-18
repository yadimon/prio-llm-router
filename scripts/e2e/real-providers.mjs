import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const keepArtifacts = process.env.E2E_KEEP_ARTIFACTS === '1';
const providerSelection = (
  process.env.E2E_REAL_PROVIDERS ??
  'groq,openrouter,vercel'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const localEnvPath = path.join(scriptDir, '.env');
loadEnvFile(localEnvPath);

const providerSpecs = [
  {
    id: 'groq',
    envKey: 'GROQ_API_KEY',
    provider: {
      name: 'groq-main',
      type: 'groq',
      auth: { mode: 'single', apiKey: process.env.GROQ_API_KEY ?? '' },
    },
    model: process.env.E2E_GROQ_MODEL ?? 'openai/gpt-oss-20b',
    expectedToken: 'GROQ_OK',
  },
  {
    id: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    provider: {
      name: 'openrouter-main',
      type: 'openrouter',
      auth: { mode: 'single', apiKey: process.env.OPENROUTER_API_KEY ?? '' },
      appName: 'prio-llm-router-e2e',
      appUrl: 'https://example.com/prio-llm-router-e2e',
    },
    model: process.env.E2E_OPENROUTER_MODEL ?? 'openai/gpt-4.1-nano',
    expectedToken: 'OPENROUTER_OK',
  },
  {
    id: 'vercel',
    envKey: 'AI_GATEWAY_API_KEY',
    provider: {
      name: 'vercel-main',
      type: 'vercel',
      auth: { mode: 'single', apiKey: process.env.AI_GATEWAY_API_KEY ?? '' },
    },
    model: process.env.E2E_VERCEL_MODEL ?? 'openai/gpt-5-nano',
    expectedToken: 'VERCEL_OK',
  },
];

const selectedSpecs = providerSpecs.filter((spec) =>
  providerSelection.includes(spec.id),
);

if (selectedSpecs.length === 0) {
  throw new Error(
      `No providers selected. Set E2E_REAL_PROVIDERS to a comma-separated list from: ${providerSpecs
      .map((spec) => spec.id)
      .join(', ')}`,
  );
}

for (const spec of selectedSpecs) {
  if (!process.env[spec.envKey]?.trim()) {
    throw new Error(
      `Missing ${spec.envKey}. Put it in scripts/e2e/.env or export it before running npm run test:e2e:real.`,
    );
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'prio-llm-router-e2e-'));
const tarballName = runNpm(['pack'], { cwd: repoRoot })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .at(-1);

if (!tarballName) {
  throw new Error('npm pack did not produce a tarball filename.');
}

const tarballPath = path.join(repoRoot, tarballName);
const tempPackageJsonPath = path.join(tempRoot, 'package.json');
const tempRunnerPath = path.join(tempRoot, 'run-e2e.mjs');

writeFileSync(
  tempPackageJsonPath,
  JSON.stringify(
    {
      name: 'prio-llm-router-e2e-temp',
      private: true,
      type: 'module',
    },
    null,
    2,
  ),
);

runNpm(['install', '--no-package-lock', '--no-save', tarballPath], {
  cwd: tempRoot,
});

writeFileSync(
  tempRunnerPath,
  `
import { createLlmRouter } from '@yadimon/prio-llm-router';

const specs = ${JSON.stringify(
    selectedSpecs.map((spec) => ({
      id: spec.id,
      provider: spec.provider,
      model: spec.model,
      expectedToken: spec.expectedToken,
    })),
    null,
    2,
  )};

for (const spec of specs) {
  const router = createLlmRouter({
    providers: [spec.provider],
    models: [
      {
        name: \`\${spec.id}-target\`,
        provider: spec.provider.name,
        model: spec.model,
        priority: 10,
      },
    ],
  });

  const startedAt = Date.now();
  const result = await router.generateText({
    prompt: \`Return exactly \${spec.expectedToken} and nothing else.\`,
    temperature: 0,
    maxOutputTokens: 512,
    attemptTimeoutMs: 45000,
  });
  const durationMs = Date.now() - startedAt;
  const normalizedText = result.text.trim().replace(/^"|"$/g, '');

  if (!normalizedText.includes(spec.expectedToken)) {
    throw new Error(
      \`Unexpected text for \${spec.id}: "\${result.text}" (expected "\${spec.expectedToken}")\`,
    );
  }

  if (!result.usage || typeof result.usage.totalTokens !== 'number') {
    throw new Error(\`Missing usage.totalTokens for \${spec.id}\`);
  }

  if (result.attempts.length !== 1 || result.attempts[0]?.success !== true) {
    throw new Error(\`Unexpected attempts payload for \${spec.id}\`);
  }

  console.log(
    JSON.stringify(
      {
        provider: spec.id,
        model: spec.model,
        text: result.text,
        usage: result.usage,
        target: result.target,
        durationMs,
      },
      null,
      2,
    ),
  );
}

process.exit(0);
`,
);

try {
  runNode(tempRunnerPath, { cwd: tempRoot });
} finally {
  if (!keepArtifacts) {
    if (existsSync(tempRunnerPath)) {
      unlinkSync(tempRunnerPath);
    }
    if (existsSync(tempPackageJsonPath)) {
      unlinkSync(tempPackageJsonPath);
    }
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
    if (existsSync(tarballPath)) {
      unlinkSync(tarballPath);
    }
  }
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    return;
  }

  const contents = readFileSync(envPath, 'utf8');
  const lines = contents.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalizedLine = line.startsWith('export ')
      ? line.slice('export '.length)
      : line;
    const separatorIndex = normalizedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const value = stripWrappingQuotes(
      normalizedLine.slice(separatorIndex + 1).trim(),
    );
    process.env[key] = value;
  }
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function runNpm(args, options) {
  if (process.platform === 'win32') {
    return execFileSync(
      'cmd.exe',
      ['/d', '/s', '/c', `npm ${args.map(quoteWindowsArg).join(' ')}`],
      {
        cwd: options.cwd,
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
  }

  return execFileSync('npm', args, {
    cwd: options.cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function runNode(entryFile, options) {
  execFileSync(process.execPath, [entryFile], {
    cwd: options.cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
}

function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}
