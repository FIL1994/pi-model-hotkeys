import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const modifiers = ["alt", "ctrl", "ctrl+alt", "alt+shift"] as const;
export const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Slot = { provider: string; model: string; thinking?: typeof levels[number]; label?: string };
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
  validateConfig(value);
  return value;
}

export function validateConfig(value: unknown): asserts value is Config {
  if (!value || !modifiers.includes((value as Config).modifier) || !(value as Config).slots ||
      typeof (value as Config).slots !== "object" || Array.isArray((value as Config).slots)) {
    throw new Error("Invalid model-hotkeys config");
  }
  for (const [key, slot] of Object.entries((value as Config).slots) as [string, Slot][]) {
    if (!/^[1-9]$/.test(key) || !slot || typeof slot.provider !== "string" || slot.provider !== slot.provider.trim() || !slot.provider ||
        typeof slot.model !== "string" || slot.model !== slot.model.trim() || !slot.model ||
        (slot.label !== undefined && (typeof slot.label !== "string" || slot.label !== slot.label.trim() || !slot.label || /[\u0000-\u001f\u007f]/.test(slot.label))) ||
        (slot.thinking !== undefined && !levels.includes(slot.thinking))) {
      throw new Error(`Invalid model-hotkeys slot: ${key}`);
    }
  }
}

// Read immediately before each mutation so other sessions' unrelated edits survive.
export function updateConfig(path: string, edit: (config: Config) => void): Config {
  const config = readConfig(path);
  edit(config);
  validateConfig(config);
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
