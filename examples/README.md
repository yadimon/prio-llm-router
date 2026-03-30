# Examples

These examples are meant for local repository development.

They import from `../src/index.js` so they work against the current source tree. If you use the published package in another project, replace that import with:

```ts
import {
  createOpenAICompatibleConnection,
  createOpenRouterConnection,
  createOpenRouterFreeSource,
  createLlmRouter,
} from '@yadimon/prio-llm-router';
```

## Files

- [basic-generate.ts](./basic-generate.ts)
- [basic-stream.ts](./basic-stream.ts)
- [free-first.ts](./free-first.ts)
- [lm-studio-local.ts](./lm-studio-local.ts)
- [openai-compatible.ts](./openai-compatible.ts)

## Running Examples

You can run them with your preferred TypeScript runner, for example:

```bash
npx tsx examples/basic-generate.ts
```

```bash
npx tsx examples/basic-stream.ts
```

```bash
npx tsx examples/free-first.ts
```

```bash
npx tsx examples/lm-studio-local.ts
```

```bash
npx tsx examples/openai-compatible.ts
```
