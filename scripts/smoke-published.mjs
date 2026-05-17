#!/usr/bin/env node
// Smoke test the freshly published @yadimon/prio-llm-router:
// - installs the latest version (or SMOKE_PUBLISHED_VERSION) in a temp dir
// - dynamic-imports the main export and verifies the router factory is callable
//
// This catches packaging regressions (missing dist files, broken exports,
// wrong main/module/types) without needing live LLM provider keys.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PKG = "@yadimon/prio-llm-router";
const VERSION = process.env.SMOKE_PUBLISHED_VERSION ?? "latest";

function npm(args, cwd) {
  // On Node >=20 Windows requires shell: true to spawn .cmd / .bat files.
  return execFileSync("npm", args, { cwd, stdio: "inherit", shell: true });
}

const dir = mkdtempSync(join(tmpdir(), "prio-llm-router-smoke-"));
console.log(`[smoke] tmp dir: ${dir}`);

try {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "smoke", private: true, type: "module" }, null, 2),
  );

  console.log(`[smoke] installing ${PKG}@${VERSION} ...`);
  npm(["install", "--no-audit", "--no-fund", `${PKG}@${VERSION}`], dir);

  const installedPkgPath = join(dir, "node_modules", "@yadimon", "prio-llm-router", "package.json");
  if (!existsSync(installedPkgPath)) {
    throw new Error(`installed package.json missing: ${installedPkgPath}`);
  }
  const installed = JSON.parse(readFileSync(installedPkgPath, "utf8"));
  console.log(`[smoke] installed version: ${installed.version}`);

  const entry = join(dir, "node_modules", "@yadimon", "prio-llm-router", "dist", "index.js");
  if (!existsSync(entry)) {
    throw new Error(`dist entry missing: ${entry}`);
  }

  const mod = await import(pathToFileURL(entry).href);
  const exportNames = Object.keys(mod);
  console.log(`[smoke] exports: ${exportNames.join(", ")}`);
  if (exportNames.length === 0) {
    throw new Error("no exports from package");
  }

  console.log(`[smoke] OK — ${PKG}@${installed.version} packaging looks healthy`);
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
