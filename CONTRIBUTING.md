# Contributing

Thanks for contributing to `prio-llm-router`.

## Development Setup

```bash
npm install
npm run check
```

The repository targets Node.js `>=18.18` and uses npm as the package manager.

## Project Expectations

- Keep the public API small and explicit.
- Keep routing behavior deterministic from configuration alone.
- Do not add hidden fallback heuristics.
- Reuse existing provider SDKs instead of custom HTTP clients when possible.
- Keep user-facing documentation in English.

## Before Opening a Pull Request

Please make sure to:

1. Update `README.md` for public API or setup changes.
2. Add or update focused docs under `docs/` when behavior is non-trivial.
3. Add or update runnable examples under `examples/` for new public features.
4. Run `npm run check`.

## Pull Request Guidelines

- Use clear, focused pull requests.
- Add tests for behavior changes.
- Keep changes minimal and publish-ready.
- Use Conventional Commits for commit messages such as `feat:`, `fix:`, `docs:`, or `chore:`.
