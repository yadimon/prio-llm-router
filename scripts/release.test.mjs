import { describe, expect, it } from 'vitest';
import { release } from './release.mjs';

describe('release workflow', () => {
  const cleanMain = (args) => args[0] === 'branch' ? 'main' : args[0] === 'status' ? '' : 'same-sha';
  // Lookup instead of branching, so a state that stops matching shows up as a failing
  // test rather than as a silently skipped condition.
  const captureOn = (overrides) => (args) => overrides[args.join(' ')] ?? cleanMain(args);
  // Reports the pre-bump version until `npm version` has run, so reading it too early
  // shows up as the wrong version in the commit message and tag.
  const versionAfterBump = (calls, bumped) => () => ['0.0.0', bumped][Number(calls.some((call) => call[1] === 'version'))];
  const recorder = () => {
    const calls = [];
    return { calls, run: (command, args) => calls.push([command, ...args]) };
  };

  it.each([['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']])(
    'runs the exact %s release sequence', (level, version) => {
      const { calls, run } = recorder();
      release(level, { run, capture: cleanMain, readVersion: versionAfterBump(calls, version) });
      expect(calls).toEqual([
        ['git', 'fetch', 'origin', 'main', '--quiet'],
        ['npm', 'run', 'check'],
        ['npm', 'version', level, '--no-git-tag-version'],
        ['npm', 'run', 'publish:dry-run'],
        ['git', 'add', '--', 'package.json', 'package-lock.json'],
        ['git', 'commit', '-m', `chore(release): v${version}`],
        ['git', 'tag', '-a', `v${version}`, '-m', `Release v${version}`],
        ['git', 'push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/v${version}`]
      ]);
    });

  it.each([
    ['branch', { 'branch --show-current': 'feature' }],
    ['dirty', { 'status --porcelain': ' M src/index.ts' }],
    ['behind', { 'rev-parse origin/main': 'new-sha' }]
  ])('stops before changing versions on %s state', (_state, overrides) => {
    const { calls, run } = recorder();
    expect(() => release('patch', { run, capture: captureOn(overrides) })).toThrow();
    expect(calls.some((call) => call[0] === 'npm')).toBe(false);
  });

  it('rejects a level that is not patch, minor or major', () => {
    const { calls, run } = recorder();
    expect(() => release('bogus', { run, capture: cleanMain })).toThrow('Expected patch, minor or major');
    expect(calls).toEqual([]);
  });

  it('does not commit, tag or push when the bumped version is not a plain semver', () => {
    const { calls, run } = recorder();
    expect(() => release('patch', { run, capture: cleanMain, readVersion: () => '1.2' }))
      .toThrow('Unexpected release version');
    expect(calls.some((call) => ['add', 'commit', 'tag', 'push'].includes(call[1]))).toBe(false);
  });

  it('does not stage, commit, tag or push when the publish rehearsal fails', () => {
    const calls = [];
    const failures = { 'npm run publish:dry-run': () => { throw new Error('publish rehearsal failed'); } };
    const run = (command, args) => {
      calls.push([command, ...args]);
      return failures[[command, ...args].join(' ')]?.();
    };
    expect(() => release('patch', { run, capture: cleanMain, readVersion: versionAfterBump(calls, '1.2.4') }))
      .toThrow('publish rehearsal failed');
    expect(calls.some((call) => ['add', 'commit', 'tag', 'push'].includes(call[1]))).toBe(false);
  });
});
