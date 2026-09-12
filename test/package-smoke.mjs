import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const consumer = mkdtempSync(join(tmpdir(), "pi-model-hotkeys-smoke-"));

function runNpm(args, cwd) {
  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, LEFTHOOK: "0", npm_config_dry_run: "false" },
  });
}

try {
  runNpm(["pack", "--ignore-scripts", "--pack-destination", consumer], root);
  const tarballs = readdirSync(consumer).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, "Expected one packed tarball");
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "pi-model-hotkeys-smoke-consumer",
      private: true,
      type: "module",
      dependencies: {
        [manifest.name]: `file:./${tarballs[0]}`,
        "@earendil-works/pi-coding-agent":
          manifest.devDependencies["@earendil-works/pi-coding-agent"],
      },
    }),
  );
  console.log(runNpm(["install", "--omit=dev", "--no-audit", "--no-fund"], consumer));
  copyFileSync(
    new URL("./fixtures/installed-package.mjs", import.meta.url),
    join(consumer, "smoke.mjs"),
  );
  execFileSync(process.execPath, ["smoke.mjs"], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 30_000,
    env: { ...process.env, PI_CODING_AGENT_DIR: join(consumer, "agent"), PI_OFFLINE: "1" },
  });
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
