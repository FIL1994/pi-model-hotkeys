import assert from "node:assert/strict";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

// Exercise Pi's real manifest discovery and TypeScript loader in a clean install.
const cwd = process.cwd();
const result = await discoverAndLoadExtensions(
  [process.env.PI_SMOKE_EXTENSION_PATH ?? join(cwd, "node_modules/@philvr/pi-model-hotkeys")],
  cwd,
  join(cwd, "agent"),
);
assert.deepEqual(result.errors, [], "Installed extension must load without errors");
assert.equal(result.extensions.length, 1);
const [extension] = result.extensions;
assert.ok(extension.commands.has("model-hotkeys"));
assert.equal(extension.shortcuts.size, 9);
console.log("Installed package smoke test passed (Pi loader and nine shortcuts).");
