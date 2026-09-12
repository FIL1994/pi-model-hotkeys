import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "pi-model-hotkeys-git-"));
const checkout = join(temporary, "package");

function run(command, args, cwd, env = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, npm_config_dry_run: "false", ...env },
  });
}

try {
  // This mirrors Pi's Git package installer: clone, then install without dev deps.
  // Use a clean copy for a dirty local checkout so the test covers current edits.
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  if (!status.trim()) {
    run("git", ["clone", "--quiet", "--no-local", root, checkout], temporary);
  } else {
    cpSync(root, checkout, {
      recursive: true,
      filter: (source) => {
        const path = relative(root, source);
        return !path.split(sep).some((segment) => segment === ".git" || segment === "node_modules");
      },
    });
  }
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], checkout);
  const fixture = fileURLToPath(new URL("./fixtures/git-installed-package.mjs", import.meta.url));
  run(process.execPath, [fixture], checkout, {
    PI_CODING_AGENT_DIR: join(checkout, "agent"),
    PI_SMOKE_EXTENSION_PATH: checkout,
    PI_OFFLINE: "1",
  });
  console.log("Git install smoke test passed.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
