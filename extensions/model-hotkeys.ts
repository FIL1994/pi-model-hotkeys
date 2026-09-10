import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { watchFile, unwatchFile } from "node:fs";
import { join } from "node:path";
import { levels, modifiers, readConfig, updateConfig, type Config, type Slot } from "./config.ts";

const describe = (slot?: Slot) => slot
  ? `${slot.provider}/${slot.model}${slot.thinking ? ` (${slot.thinking})` : ""}`
  : "Unassigned";

export function registerModelHotkeys(pi: ExtensionAPI, path: string) {
  let modifier: Config["modifier"] = "alt";
  try { modifier = readConfig(path).modifier; } catch { /* Report on session start. */ }
  let switching = false;
  let configuring = false;
  let stopWatching: (() => void) | undefined;

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
          const active = ctx.model?.provider === slot.provider && ctx.model?.id === slot.model;
          const label = `${active ? "● " : ""}${modifier}+${key} ${describe(slot)}`;
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
    stopWatching?.();
    refreshLegend(ctx);
    if (ctx.mode === "tui") {
      const listener = () => refreshLegend(ctx);
      watchFile(path, { persistent: false, interval: 1000 }, listener);
      stopWatching = () => { unwatchFile(path, listener); stopWatching = undefined; };
    }
    try { readConfig(path); } catch (error) {
      ctx.ui.notify(`Model hotkeys: ${error}. Fix ${path}; existing config will not be overwritten.`, "error");
    }
  });
  pi.on("model_select", (_event, ctx) => refreshLegend(ctx));
  pi.on("thinking_level_select", (_event, ctx) => refreshLegend(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
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
            ctx.ui.notify(`Authentication unavailable for ${slot.provider}. Use /login.`, "error");
            return;
          }
          if (slot.thinking !== undefined) pi.setThinkingLevel(slot.thinking);
          ctx.ui.notify(`Slot ${key}: ${slot.provider}/${slot.model} (${pi.getThinkingLevel()})`, "info");
        } catch (error) {
          ctx.ui.notify(`Cannot switch model: ${error}`, "error");
        } finally { switching = false; refreshLegend(ctx); }
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
      try {
        while (true) {
          const config = readConfig(path);
          const rows = Array.from({ length: 9 }, (_, i) => `${i + 1}: ${describe(config.slots[String(i + 1)])}`);
          const modifierRow = `Modifier: ${config.modifier} (active: ${modifier})`;
          const choice = argument ? rows[Number(argument) - 1] : await ctx.ui.select(
            "Model hotkeys — select a slot to configure", [...rows, modifierRow, "Done"],
          );
          if (!choice || choice === "Done") return;
          if (choice === modifierRow) {
            const selected = await ctx.ui.select("Hotkey modifier (requires /reload)", [...modifiers]);
            if (selected) {
              updateConfig(path, next => { next.modifier = selected as Config["modifier"]; });
              refreshLegend(ctx);
              ctx.ui.notify("Modifier saved. Run /reload in each open session to activate it.", "info");
            }
            continue;
          }
          const key = String(rows.indexOf(choice) + 1);
          const action = await ctx.ui.select(`Configure slot ${key}`, ["Choose model", "Use current model and thinking", "Clear slot"]);
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
              const provider = await ctx.ui.select("Provider", providers);
              if (provider) {
                const model = await ctx.ui.select("Model", models.filter(m => m.provider === provider).map(m => m.id).sort());
                if (model) {
                  const thinking = await ctx.ui.select("Thinking level (clamped to model capabilities)", ["Keep current", ...levels]);
                  if (thinking) slot = { provider, model, ...(thinking === "Keep current" ? {} : { thinking: thinking as Slot["thinking"] }) };
                }
              }
            }
          }
          if (slot) {
            updateConfig(path, next => { next.slots[key] = slot; });
            refreshLegend(ctx);
            ctx.ui.notify(`Slot ${key} saved: ${describe(slot)}`, "info");
          }
          if (argument) return;
        }
      } catch (error) {
        ctx.ui.notify(`Cannot configure model hotkeys: ${error}. Config: ${path}`, "error");
      } finally { configuring = false; refreshLegend(ctx); }
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerModelHotkeys(pi, join(getAgentDir(), "model-hotkeys.json"));
}
