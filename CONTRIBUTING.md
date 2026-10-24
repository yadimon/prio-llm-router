# Contributing

Thanks for contributing to `prio-llm-router`.

## Development Setup

```bash
npm install
npm run check
```

The published package targets Node.js `>=18.18` and the repository uses npm as
the package manager. Local development needs a newer Node than that floor, because
the build and test toolchain requires it: tsup 9 needs
`^22.18.0 || ^24.11.0 || >=26.0.0` and vitest 5 needs
`^22.12.0 || ^24.0.0 || >=26.0.0`. CI runs the toolchain on Node 22 and 24.

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
