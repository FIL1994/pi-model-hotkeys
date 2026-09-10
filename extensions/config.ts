import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const modifiers = ["alt", "ctrl", "ctrl+alt", "alt+shift"] as const;
export const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Slot = { provider: string; model: string; thinking?: typeof levels[number] };
export type Config = { modifier: typeof modifiers[number]; slots: Record<string, Slot> };

export function readConfig(path: string): Config {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { modifier: "alt", slots: {} };
    throw error;
  }
  const value = JSON.parse(raw);
  if (!value || !modifiers.includes(value.modifier) || !value.slots ||
      typeof value.slots !== "object" || Array.isArray(value.slots)) {
    throw new Error("Invalid model-hotkeys config");
  }
  for (const [key, slot] of Object.entries(value.slots) as [string, Slot][]) {
    if (!/^[1-9]$/.test(key) || !slot || typeof slot.provider !== "string" || !slot.provider.trim() ||
        typeof slot.model !== "string" || !slot.model.trim() ||
        (slot.thinking !== undefined && !levels.includes(slot.thinking))) {
      throw new Error(`Invalid model-hotkeys slot: ${key}`);
    }
  }
  return value;
}

// Read immediately before each mutation so other sessions' unrelated edits survive.
export function updateConfig(path: string, edit: (config: Config) => void): Config {
  const config = readConfig(path);
  edit(config);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return config;
}
