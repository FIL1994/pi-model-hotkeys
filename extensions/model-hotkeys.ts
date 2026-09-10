import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { watchFile, unwatchFile } from "node:fs";
import { join } from "node:path";
import {
  levels, modelNameStyles, modifiers, readConfig, updateConfig,
  type Config, type ModelNameStyle, type Slot,
} from "./config.ts";

const describe = (slot?: Slot) => slot
  ? `${slot.label ? `${slot.label} — ` : ""}${slot.provider}/${slot.model}${slot.thinking ? ` (${slot.thinking})` : ""}`
  : "Unassigned";

const styleChoices: Record<ModelNameStyle, string> = {
  full: "Full — provider/model ID",
  friendly: "Friendly — catalogue name",
  short: "Short — model ID",
  compact: "Compact — family name",
};

const versionToken = /^(?:v?\d+(?:[._]\d+)*(?:b|k)?|\d{8})$/i;
const suffixNoise = new Set(["latest", "preview", "experimental", "exp"]);

/** Derive a compact, stable family label from a model ID. */
export function compactModelName(modelId: string): string {
  const base = modelId.split("/").at(-1) ?? modelId;
  const tokens = base.split("-").filter(Boolean);
  const meaningful = tokens.filter(token => !versionToken.test(token) && !suffixNoise.has(token.toLowerCase()));
  if (meaningful.length < 2) {
    const removedOnlyNoise = tokens.some(token => suffixNoise.has(token.toLowerCase())) &&
      !tokens.some(token => versionToken.test(token));
    return meaningful.length === 1 && removedOnlyNoise ? meaningful[0] : base;
  }

  const root = meaningful[0].toLowerCase();
  const family = meaningful.slice(root === "gpt" || root === "claude" ? 1 : 0);
  return family.length ? family.join("-") : base;
}

type Watch = (path: string, options: { persistent: boolean; interval: number }, listener: () => void) => (() => void);

export function registerModelHotkeys(pi: ExtensionAPI, path: string, watch: Watch = (path, options, listener) => {
  watchFile(path, options, listener);
  return () => unwatchFile(path, listener);
}) {
  let modifier: Config["modifier"] = "alt";
  try { modifier = readConfig(path).modifier; } catch { /* Report on session start. */ }
  let switching = false;
  let configuring = false;
  let stopWatching: (() => void) | undefined;
  let lifecycle = new AbortController();
  const alive = (signal: AbortSignal) => !signal.aborted && signal === lifecycle.signal;

  function refreshLegend(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    let config: Config;
    try { config = readConfig(path); } catch {
      ctx.ui.setWidget("model-hotkeys", ["Model hotkeys: invalid config — /model-hotkeys"], { placement: "belowEditor" });
      return;
    }
    ctx.ui.setWidget("model-hotkeys", (_tui, theme) => ({
      render(width) {
        if (width < 1) return [];
        const entries = Object.entries(config.slots).sort(([a], [b]) => Number(a) - Number(b));
        const labels = entries.map(([key, slot]) => {
          const active = ctx.model?.provider === slot.provider && ctx.model?.id === slot.model &&
            (slot.thinking === undefined || slot.thinking === pi.getThinkingLevel());
          const style = config.modelNameStyle ?? "short";
          const others = entries.map(([, other]) => other).filter(other => !other.label && other !== slot);
          const sameTarget = (other: Slot) => other.provider === slot.provider && other.model === slot.model;
          let modelLabel: string;
          if (style === "full") {
            modelLabel = `${slot.provider}/${slot.model}`;
          } else if (style === "friendly") {
            const friendly = ctx.modelRegistry.find(slot.provider, slot.model)?.name || slot.model;
            const ambiguous = others.some(other => !sameTarget(other) &&
              (ctx.modelRegistry.find(other.provider, other.model)?.name || other.model) === friendly);
            modelLabel = ambiguous ? `${friendly} — ${slot.provider}/${slot.model}` : friendly;
          } else if (style === "compact") {
            const compact = compactModelName(slot.model);
            const collisions = others.filter(other => !sameTarget(other) && compactModelName(other.model) === compact);
            if (!collisions.length) modelLabel = compact;
            else if (collisions.every(other => other.provider !== slot.provider)) modelLabel = `${slot.provider}/${compact}`;
            else modelLabel = `${slot.provider}/${slot.model}`;
          } else {
            // Keep the model ID intact; qualify only collisions across providers.
            const ambiguous = others.some(other => other.model === slot.model && other.provider !== slot.provider);
            modelLabel = ambiguous ? `${slot.provider}/${slot.model}` : slot.model;
          }
          const label = `${active ? "● " : ""}${modifier}+${key} ${slot.label ?? modelLabel}${slot.thinking ? ` (${slot.thinking})` : ""}`;
          return theme.fg(active ? "accent" : "muted", label);
        });
        const text = labels.length ? labels.join(theme.fg("dim", "  |  "))
          : theme.fg("dim", "Model hotkeys: no slots assigned — /model-hotkeys");
        const pending = config.modifier !== modifier
          ? theme.fg("warning", `  [${config.modifier} pending /reload]`) : "";
        return wrapTextWithAnsi(text + pending, width);
      },
      invalidate() {},
    }), { placement: "belowEditor" });
  }

  pi.on("session_start", (_event, ctx) => {
    lifecycle.abort();
    lifecycle = new AbortController();
    switching = false;
    configuring = false;
    stopWatching?.();
    refreshLegend(ctx);
    if (ctx.mode === "tui") {
      const signal = lifecycle.signal;
      const listener = () => { if (alive(signal)) refreshLegend(ctx); };
      const cleanup = watch(path, { persistent: false, interval: 1000 }, listener);
      stopWatching = () => { cleanup(); stopWatching = undefined; };
    }
    try { readConfig(path); } catch (error) {
      ctx.ui.notify(`Model hotkeys: ${error}. Fix ${path}; existing config will not be overwritten.`, "error");
    }
  });
  pi.on("model_select", (_event, ctx) => refreshLegend(ctx));
  pi.on("thinking_level_select", (_event, ctx) => refreshLegend(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    lifecycle.abort();
    stopWatching?.();
    if (ctx.mode === "tui") ctx.ui.setWidget("model-hotkeys", undefined);
  });

  for (let number = 1; number <= 9; number++) {
    const key = String(number);
    pi.registerShortcut(`${modifier}+${number}` as Parameters<ExtensionAPI["registerShortcut"]>[0], {
      description: `Switch to model slot ${number} (/model-hotkeys to configure)`,
      async handler(ctx) {
        if (switching || configuring) return;
        if (!ctx.isIdle()) {
          ctx.ui.notify("Wait for Pi to finish, or abort the response before switching models.", "warning");
          return;
        }
        switching = true;
        const signal = lifecycle.signal;
        try {
          const slot = readConfig(path).slots[key];
          if (!slot) {
            ctx.ui.notify(`Slot ${key} is unassigned. Use /model-hotkeys ${key}.`, "info");
            return;
          }
          const model = ctx.modelRegistry.find(slot.provider, slot.model);
          if (!model) {
            ctx.ui.notify(`Model not found: ${describe(slot)}. Reassign it with /model-hotkeys ${key}.`, "error");
            return;
          }
          if (!await pi.setModel(model)) {
            if (!alive(signal)) return;
            ctx.ui.notify(`Authentication unavailable for ${slot.provider}. Use /login.`, "error");
            return;
          }
          if (!alive(signal)) return;
          const requestedThinking = slot.thinking;
          if (slot.thinking !== undefined) pi.setThinkingLevel(slot.thinking);
          if (!alive(signal)) return;
          if (requestedThinking !== undefined && pi.getThinkingLevel() !== requestedThinking) {
            ctx.ui.notify(`Slot ${key}: ${requestedThinking} is unsupported by ${slot.provider}/${slot.model}; using ${pi.getThinkingLevel()}.`, "warning");
          }
          ctx.ui.notify(`Slot ${key}: ${slot.provider}/${slot.model} (${pi.getThinkingLevel()})`, "info");
        } catch (error) {
          if (!alive(signal)) return;
          ctx.ui.notify(`Cannot switch model: ${error}`, "error");
        } finally { if (alive(signal)) { switching = false; refreshLegend(ctx); } }
      },
    });
  }

  pi.registerCommand("model-hotkeys", {
    description: "Configure model slots 1–9 and hotkey modifier; optionally pass a slot number",
    async handler(args, ctx) {
      if (!ctx.hasUI) return;
      if (configuring || switching) return;
      const argument = args.trim();
      if (argument && !/^[1-9]$/.test(argument)) {
        ctx.ui.notify("Usage: /model-hotkeys [1-9]", "warning");
        return;
      }
      configuring = true;
      const signal = lifecycle.signal;
      try {
        while (true) {
          const config = readConfig(path);
          const rows = Array.from({ length: 9 }, (_, i) => `${i + 1}: ${describe(config.slots[String(i + 1)])}`);
          const modifierRow = `Modifier: ${config.modifier} (active: ${modifier})`;
          const modelNameStyleRow = `Model names: ${styleChoices[config.modelNameStyle ?? "short"]}`;
          const choice = argument ? rows[Number(argument) - 1] : await ctx.ui.select(
            "Model hotkeys — select a slot to configure", [...rows, modifierRow, modelNameStyleRow, "Done"],
            { signal },
          );
          if (!alive(signal)) return;
          if (!choice || choice === "Done") return;
          if (choice === modifierRow) {
            const selected = await ctx.ui.select("Hotkey modifier (requires /reload)", [...modifiers], { signal });
            if (!alive(signal)) return;
            if (selected) {
              updateConfig(path, next => { next.modifier = selected as Config["modifier"]; });
              refreshLegend(ctx);
              ctx.ui.notify("Modifier saved. Run /reload in each open session to activate it.", "info");
            }
            continue;
          }
          if (choice === modelNameStyleRow) {
            const selected = await ctx.ui.select("Model name style", modelNameStyles.map(style => styleChoices[style]), { signal });
            if (!alive(signal)) return;
            const style = modelNameStyles.find(candidate => styleChoices[candidate] === selected);
            if (style) {
              updateConfig(path, next => { next.modelNameStyle = style; });
              refreshLegend(ctx);
              ctx.ui.notify(`Model names now use the ${style} style.`, "info");
            }
            continue;
          }
          const key = String(rows.indexOf(choice) + 1);
          const action = await ctx.ui.select(`Configure slot ${key}`, ["Choose model", "Use current model and thinking", "Set/remove label", "Clear slot"], { signal });
          if (!alive(signal)) return;
          if (action === "Set/remove label") {
            const current = config.slots[key]?.label ?? "";
            const label = await ctx.ui.input(`Label for slot ${key} (blank removes it)`, current, { signal });
            if (!alive(signal)) return;
            if (label === undefined) { if (argument) return; continue; }
            const trimmed = label.trim();
            if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
              ctx.ui.notify("Labels cannot contain control characters.", "warning");
              continue;
            }
            if (!config.slots[key]) {
              ctx.ui.notify(`Slot ${key} is unassigned; choose a model before setting a label.`, "warning");
              if (argument) return;
              continue;
            }
            updateConfig(path, next => {
              const existing = next.slots[key];
              if (!existing) return;
              if (trimmed) existing.label = trimmed; else delete existing.label;
            });
            refreshLegend(ctx);
            ctx.ui.notify(trimmed ? `Slot ${key} labeled “${trimmed}”.` : `Slot ${key} label removed.`, "info");
            if (argument) return;
            continue;
          }
          let slot: Slot | undefined;
          if (action === "Clear slot") {
            updateConfig(path, next => { delete next.slots[key]; });
            refreshLegend(ctx);
            ctx.ui.notify(`Slot ${key} cleared.`, "info");
          } else if (action === "Use current model and thinking") {
            if (ctx.model) slot = { provider: ctx.model.provider, model: ctx.model.id, thinking: pi.getThinkingLevel() };
            else ctx.ui.notify("No model is selected.", "warning");
          } else if (action === "Choose model") {
            const models = ctx.modelRegistry.getAvailable();
            const providers = [...new Set(models.map(model => model.provider))].sort();
            if (!providers.length) ctx.ui.notify("No available models. Configure authentication with /login first.", "warning");
            else {
              const provider = await ctx.ui.select("Provider", providers, { signal });
              if (!alive(signal)) return;
              if (provider) {
                const model = await ctx.ui.select("Model", models.filter(m => m.provider === provider).map(m => m.id).sort(), { signal });
                if (!alive(signal)) return;
                if (model) {
                  const target = models.find(m => m.provider === provider && m.id === model);
                  const supported = levels.filter(level => {
                    if (!target?.reasoning) return level === "off";
                    return target.thinkingLevelMap?.[level] !== null &&
                      (level !== "xhigh" && level !== "max" || target.thinkingLevelMap?.[level] !== undefined);
                  });
                  const thinking = await ctx.ui.select("Thinking level (clamped to model capabilities)", ["Keep current", ...supported], { signal });
                  if (!alive(signal)) return;
                  if (thinking) slot = { provider, model, ...(thinking === "Keep current" ? {} : { thinking: thinking as Slot["thinking"] }) };
                }
              }
            }
          }
          if (slot) {
            updateConfig(path, next => {
              const old = next.slots[key];
              next.slots[key] = { ...slot!, ...(old?.label ? { label: old.label } : {}) };
            });
            refreshLegend(ctx);
            ctx.ui.notify(`Slot ${key} saved: ${describe(slot)}`, "info");
          }
          if (argument) return;
        }
      } catch (error) {
        if (!alive(signal)) return;
        ctx.ui.notify(`Cannot configure model hotkeys: ${error}. Config: ${path}`, "error");
      } finally { if (alive(signal)) { configuring = false; refreshLegend(ctx); } }
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerModelHotkeys(pi, join(getAgentDir(), "model-hotkeys.json"));
}
