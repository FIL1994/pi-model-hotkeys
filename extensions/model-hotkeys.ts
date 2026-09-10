import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { watchFile, unwatchFile } from "node:fs";
import { join } from "node:path";
import {
  levels,
  modelNameStyles,
  modifiers,
  readConfig,
  updateConfig,
  type Config,
  type ModelNameStyle,
  type Slot,
} from "./config.ts";
import {
  effectivePresetDescription,
  effectiveThinkingLevel,
  filterModels,
  flatModelChoices,
  modelKey,
  ModelPickerComponent,
  modelInScope,
  thinkingChoices,
  type PickerModel,
  type ScopedPickerModel,
} from "./model-picker.ts";

const describe = (slot?: Slot) =>
  slot
    ? `${slot.label ? `${slot.label} — ` : ""}${slot.provider}/${slot.model}${slot.thinking ? ` (${slot.thinking})` : ""}`
    : "Unassigned";

const styleChoices: Record<ModelNameStyle, string> = {
  full: "Full — provider/model ID",
  friendly: "Friendly — catalogue name",
  short: "Short — model ID",
  compact: "Compact — family name",
};

function scopedSnapshot(ctx: ExtensionContext): ScopedPickerModel[] {
  return [...(ctx.scopedModels ?? [])] as ScopedPickerModel[];
}

function modelFromKey(
  models: readonly PickerModel[],
  key: string | undefined,
): PickerModel | undefined {
  return key ? models.find((model) => modelKey(model) === key) : undefined;
}

function previewLegend(
  key: string,
  slot: Slot,
  model: PickerModel,
  current: PickerModel | undefined,
  currentThinking: (typeof levels)[number],
  modifier: Config["modifier"],
  modelLabel: string,
): string {
  const effective =
    slot.thinking === undefined
      ? effectiveThinkingLevel(model, currentThinking)
      : effectiveThinkingLevel(model, slot.thinking);
  const isCurrent =
    !!current && modelKey(current) === modelKey(model) && effective === currentThinking;
  const preset = slot.thinking === undefined ? "" : ` (${slot.thinking})`;
  return `${isCurrent ? "● " : ""}${modifier}+${key} ${slot.label ?? modelLabel}${preset} — effective thinking: ${effective}`;
}

function legendModelLabel(
  config: Config,
  key: string,
  slot: Slot,
  findModel: (provider: string, model: string) => { name?: string } | undefined,
): string {
  const style = config.modelNameStyle ?? "short";
  const others = Object.entries(config.slots)
    .filter(([otherKey, other]) => otherKey !== key && !other.label)
    .map(([, other]) => other);
  const sameTarget = (other: Slot) =>
    other.provider === slot.provider && other.model === slot.model;
  if (style === "full") return `${slot.provider}/${slot.model}`;
  if (style === "friendly") {
    const friendly = findModel(slot.provider, slot.model)?.name || slot.model;
    const ambiguous = others.some(
      (other) =>
        !sameTarget(other) &&
        (findModel(other.provider, other.model)?.name || other.model) === friendly,
    );
    return ambiguous ? `${friendly} — ${slot.provider}/${slot.model}` : friendly;
  }
  if (style === "compact") {
    const compact = compactModelName(slot.model);
    const collisions = others.filter(
      (other) => !sameTarget(other) && compactModelName(other.model) === compact,
    );
    if (!collisions.length) return compact;
    return collisions.every((other) => other.provider !== slot.provider)
      ? `${slot.provider}/${compact}`
      : `${slot.provider}/${slot.model}`;
  }
  const ambiguous = others.some(
    (other) => other.model === slot.model && other.provider !== slot.provider,
  );
  return ambiguous ? `${slot.provider}/${slot.model}` : slot.model;
}

export function parseCommandArgs(args: string): { slot?: string; query?: string } | undefined {
  const trimmed = args.trim();
  if (!trimmed) return {};
  const [first, ...rest] = trimmed.split(/\s+/u);
  if (!/^[1-9]$/.test(first)) return undefined;
  return { slot: first, query: rest.join(" ") || undefined };
}

const versionToken = /^(?:v?\d+(?:[._]\d+)*(?:b|k)?|\d{8})$/i;
const suffixNoise = new Set(["latest", "preview", "experimental", "exp"]);

/** Derive a compact, stable family label from a model ID. */
export function compactModelName(modelId: string): string {
  const base = modelId.split("/").at(-1) ?? modelId;
  const tokens = base.split("-").filter(Boolean);
  const meaningful = tokens.filter(
    (token) => !versionToken.test(token) && !suffixNoise.has(token.toLowerCase()),
  );
  if (meaningful.length < 2) {
    const removedOnlyNoise =
      tokens.some((token) => suffixNoise.has(token.toLowerCase())) &&
      !tokens.some((token) => versionToken.test(token));
    return meaningful.length === 1 && removedOnlyNoise ? meaningful[0] : base;
  }

  const root = meaningful[0].toLowerCase();
  const family = meaningful.slice(root === "gpt" || root === "claude" ? 1 : 0);
  return family.length ? family.join("-") : base;
}

type Watch = (
  path: string,
  options: { persistent: boolean; interval: number },
  listener: () => void,
) => () => void;

export function registerModelHotkeys(
  pi: ExtensionAPI,
  path: string,
  watch: Watch = (path, options, listener) => {
    watchFile(path, options, listener);
    return () => unwatchFile(path, listener);
  },
) {
  let modifier: Config["modifier"] = "alt";
  try {
    modifier = readConfig(path).modifier;
  } catch {
    /* Report on session start. */
  }
  let switching = false;
  let lastSlot: string | undefined;
  const slotHandlers = new Map<string, (ctx: ExtensionContext) => Promise<void>>();
  let configuring = false;
  let stopWatching: (() => void) | undefined;
  let lifecycle = new AbortController();
  const alive = (signal: AbortSignal) => !signal.aborted && signal === lifecycle.signal;

  function refreshLegend(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    let config: Config;
    try {
      config = readConfig(path);
    } catch {
      ctx.ui.setWidget("model-hotkeys", ["Model hotkeys: invalid config — /model-hotkeys"], {
        placement: "belowEditor",
      });
      return;
    }
    ctx.ui.setWidget(
      "model-hotkeys",
      (tui, theme) => ({
        handleMouse(event: TuiMouseEvent) {
          if (
            tui.mode !== "fullscreen" ||
            event.type !== "wheel" ||
            !event.alt ||
            event.ctrl ||
            event.shift ||
            !event.wheelDelta ||
            lifecycle.signal.aborted
          )
            return;
          try {
            const current = readConfig(path);
            if (!current.altScroll) return;
            if (switching || configuring) return { handled: true };
            const entries = Object.entries(current.slots).sort(([a], [b]) => Number(a) - Number(b));
            if (!entries.length) return;
            const matches = (slot: Slot) =>
              ctx.model?.provider === slot.provider &&
              ctx.model?.id === slot.model &&
              (slot.thinking === undefined || slot.thinking === pi.getThinkingLevel());
            let index = entries.findIndex(([key, slot]) => key === lastSlot && matches(slot));
            if (index < 0) index = entries.findIndex(([, slot]) => matches(slot));
            const direction = event.wheelDelta > 0 ? 1 : -1;
            const next =
              index < 0
                ? direction > 0
                  ? 0
                  : entries.length - 1
                : (index + direction + entries.length) % entries.length;
            void slotHandlers.get(entries[next][0])?.(ctx);
            return { handled: true };
          } catch {
            // Invalid config must not break terminal input or swallow scrolling.
            return;
          }
        },
        render(width) {
          if (width < 1) return [];
          const entries = Object.entries(config.slots).sort(([a], [b]) => Number(a) - Number(b));
          const labels = entries.map(([key, slot]) => {
            const active =
              ctx.model?.provider === slot.provider &&
              ctx.model?.id === slot.model &&
              (slot.thinking === undefined || slot.thinking === pi.getThinkingLevel());
            const modelLabel = legendModelLabel(config, key, slot, (provider, model) =>
              ctx.modelRegistry.find(provider, model),
            );
            const label = `${active ? "● " : ""}${modifier}+${key} ${slot.label ?? modelLabel}${slot.thinking ? ` (${slot.thinking})` : ""}`;
            return theme.fg(active ? "accent" : "muted", label);
          });
          const text = labels.length
            ? labels.join(theme.fg("dim", "  |  "))
            : theme.fg("dim", "Model hotkeys: no slots assigned — /model-hotkeys");
          const pending =
            config.modifier !== modifier
              ? theme.fg("warning", `  [${config.modifier} pending /reload]`)
              : "";
          return wrapTextWithAnsi(text + pending, width);
        },
        invalidate() {},
      }),
      { placement: "belowEditor" },
    );
  }

  pi.on("session_start", (_event, ctx) => {
    lifecycle.abort();
    lifecycle = new AbortController();
    switching = false;
    lastSlot = undefined;
    configuring = false;
    stopWatching?.();
    refreshLegend(ctx);
    if (ctx.mode === "tui") {
      const signal = lifecycle.signal;
      const listener = () => {
        if (alive(signal)) refreshLegend(ctx);
      };
      const cleanup = watch(path, { persistent: false, interval: 1000 }, listener);
      stopWatching = () => {
        cleanup();
        stopWatching = undefined;
      };
    }
    try {
      readConfig(path);
    } catch (error) {
      ctx.ui.notify(
        `Model hotkeys: ${error}. Fix ${path}; existing config will not be overwritten.`,
        "error",
      );
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
    const shortcut = {
      description: `Switch to model slot ${number} (/model-hotkeys to configure)`,
      async handler(ctx: ExtensionContext) {
        if (switching || configuring) return;
        if (!ctx.isIdle()) {
          ctx.ui.notify(
            "Wait for Pi to finish, or abort the response before switching models.",
            "warning",
          );
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
          const scope = scopedSnapshot(ctx);
          if (scope.length && !modelInScope({ provider: slot.provider, id: slot.model }, scope)) {
            ctx.ui.notify(
              `Slot ${key} is outside the current model scope (${slot.provider}/${slot.model}); refusing to switch.`,
              "warning",
            );
            return;
          }
          const model = ctx.modelRegistry.find(slot.provider, slot.model);
          if (!model) {
            ctx.ui.notify(
              `Model not found: ${describe(slot)}. Reassign it with /model-hotkeys ${key}.`,
              "error",
            );
            return;
          }
          if (!(await pi.setModel(model))) {
            if (!alive(signal)) return;
            ctx.ui.notify(`Authentication unavailable for ${slot.provider}. Use /login.`, "error");
            return;
          }
          if (!alive(signal)) return;
          const requestedThinking = slot.thinking;
          if (slot.thinking !== undefined) pi.setThinkingLevel(slot.thinking);
          if (!alive(signal)) return;
          lastSlot = key;
          if (requestedThinking !== undefined && pi.getThinkingLevel() !== requestedThinking) {
            ctx.ui.notify(
              `Slot ${key}: ${requestedThinking} is unsupported by ${slot.provider}/${slot.model}; using ${pi.getThinkingLevel()}.`,
              "warning",
            );
          }
          ctx.ui.notify(
            `Slot ${key}: ${slot.provider}/${slot.model} (${pi.getThinkingLevel()})`,
            "info",
          );
        } catch (error) {
          if (!alive(signal)) return;
          ctx.ui.notify(`Cannot switch model: ${error}`, "error");
        } finally {
          if (alive(signal)) {
            switching = false;
            refreshLegend(ctx);
          }
        }
      },
    };
    slotHandlers.set(key, shortcut.handler);
    pi.registerShortcut(
      `${modifier}+${number}` as Parameters<ExtensionAPI["registerShortcut"]>[0],
      shortcut,
    );
  }

  pi.registerCommand("model-hotkeys", {
    description:
      "Configure model slots 1–9, modifier, labels, and display style; optionally pass a slot and search query",
    async handler(args, ctx) {
      if (!ctx.hasUI || configuring || switching) return;
      const parsed = parseCommandArgs(args);
      if (!parsed) {
        ctx.ui.notify("Usage: /model-hotkeys [1-9] [model search query]", "warning");
        return;
      }
      configuring = true;
      const signal = lifecycle.signal;

      const chooseModel = async (query: string | undefined): Promise<PickerModel | undefined> => {
        const allModels = ctx.modelRegistry.getAvailable() as PickerModel[];
        let scoped = scopedSnapshot(ctx);
        let refreshedModels = allModels;
        if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
          const selectedKey = await ctx.ui.custom<string | undefined>(
            (tui, theme, keybindings, done) =>
              new ModelPickerComponent(
                {
                  tui,
                  theme,
                  keybindings,
                  models: refreshedModels,
                  scopedModels: scoped,
                  scoped: scoped.length > 0,
                  query,
                  current: ctx.model as PickerModel | undefined,
                  slots: readConfig(path).slots,
                  lifecycle: signal,
                  refresh: async (refreshSignal) => {
                    const cached = ctx.modelRegistry.getAvailable() as PickerModel[];
                    try {
                      const result = await ctx.modelRegistry.refresh({
                        allowNetwork: true,
                        force: true,
                        signal: refreshSignal,
                      });
                      if (refreshSignal.aborted || signal.aborted) {
                        return { models: cached, status: "Refresh cancelled" };
                      }
                      const models = ctx.modelRegistry.getAvailable() as PickerModel[];
                      const updatedScoped = scoped.map((entry) => ({
                        ...entry,
                        model: (ctx.modelRegistry.find(entry.model.provider, entry.model.id) ??
                          entry.model) as PickerModel,
                      }));
                      scoped = updatedScoped;
                      const errors = result.errors?.size ?? 0;
                      return {
                        models,
                        scopedModels: updatedScoped,
                        status:
                          result.aborted || refreshSignal.aborted
                            ? "Refresh cancelled"
                            : errors
                              ? `Refresh partially completed (${errors} provider error${errors === 1 ? "" : "s"}); cached models remain available`
                              : "Model catalogue refreshed successfully",
                      };
                    } catch (error) {
                      if (refreshSignal.aborted || signal.aborted) {
                        return { models: cached, status: "Refresh cancelled" };
                      }
                      if (
                        error instanceof Error &&
                        (error.name === "TimeoutError" ||
                          /timed? ?out|timeout/i.test(error.message))
                      ) {
                        return {
                          models: cached,
                          status: "Refresh timed out; cached models remain available",
                        };
                      }
                      return {
                        models: cached,
                        status: `Refresh failed: ${error instanceof Error ? error.message : String(error)}`,
                      };
                    }
                  },
                  onRefresh: (outcome) => {
                    refreshedModels = outcome.models;
                    if (outcome.scopedModels) scoped = outcome.scopedModels;
                  },
                },
                done,
              ),
          );
          if (!alive(signal)) return undefined;
          return modelFromKey(
            [...refreshedModels, ...scoped.map((entry) => entry.model)],
            selectedKey,
          );
        }

        const source = scoped.length ? scoped.map((entry) => entry.model) : allModels;
        if (!source.length) {
          ctx.ui.notify(
            scoped.length
              ? "No models are present in the current scope."
              : "No authenticated available models. Configure authentication with /login first.",
            "warning",
          );
          return undefined;
        }
        const matching = query ? filterModels(source, query) : source;
        if (!matching.length) {
          ctx.ui.notify(`No models match “${query}”.`, "warning");
          return undefined;
        }
        const scopedThinking = new Map(
          scoped.map((entry) => [modelKey(entry.model), entry.thinkingLevel]),
        );
        const choices = flatModelChoices(matching, {
          current: ctx.model as PickerModel | undefined,
          slots: readConfig(path).slots,
          scopedThinking,
        });
        const choice = await ctx.ui.select("Choose model", choices, { signal });
        if (!alive(signal) || !choice) return undefined;
        let target = matching.find(
          (model) =>
            flatModelChoices([model], {
              current: ctx.model as PickerModel | undefined,
              slots: readConfig(path).slots,
              scopedThinking,
            })[0] === choice,
        );
        // Accept old RPC clients that still send provider then model IDs, without exposing
        // a provider-first picker in the new UI.
        if (!target) {
          const providerModels = matching.filter((model) => model.provider === choice);
          if (providerModels.length) {
            const id = await ctx.ui.select(
              "Model (legacy client)",
              providerModels.map((model) => model.id),
              { signal },
            );
            target = providerModels.find((model) => model.id === id);
          }
        }
        return target;
      };

      const confirmAndSave = async (
        key: string,
        target: PickerModel,
        requestedThinking: (typeof levels)[number] | undefined,
        label: string | undefined,
      ): Promise<boolean> => {
        if (!alive(signal)) return false;
        const currentConfig = readConfig(path);
        const savedThinking =
          requestedThinking === undefined
            ? undefined
            : effectiveThinkingLevel(target, requestedThinking);
        const duplicate = Object.entries(currentConfig.slots).find(
          ([otherKey, other]) =>
            otherKey !== key &&
            other.provider === target.provider &&
            other.model === target.id &&
            other.thinking === savedThinking,
        );
        if (duplicate && typeof ctx.ui.confirm === "function") {
          const acceptedDuplicate = await ctx.ui.confirm(
            "Duplicate preset",
            `Slot ${duplicate[0]} already has the identical ${target.provider}/${target.id} thinking preset. Save anyway?`,
            { signal },
          );
          if (!alive(signal) || !acceptedDuplicate) return false;
        }
        const previewSlot: Slot = {
          provider: target.provider,
          model: target.id,
          ...(savedThinking === undefined ? {} : { thinking: savedThinking }),
          ...(label ? { label } : {}),
        };
        const previewConfig: Config = {
          ...currentConfig,
          slots: { ...currentConfig.slots, [key]: previewSlot },
        };
        const preview = previewLegend(
          key,
          previewSlot,
          target,
          ctx.model as PickerModel | undefined,
          pi.getThinkingLevel(),
          modifier,
          legendModelLabel(previewConfig, key, previewSlot, (provider, model) =>
            ctx.modelRegistry.find(provider, model),
          ),
        );
        if (typeof ctx.ui.confirm === "function") {
          const accepted = await ctx.ui.confirm(
            `Save slot ${key}`,
            `${preview}${duplicate ? " [duplicate]" : ""}${ctx.model && modelKey(target) === modelKey(ctx.model) ? " [current model]" : ""}`,
            { signal },
          );
          if (!alive(signal) || !accepted) return false;
        }
        updateConfig(path, (next) => {
          const old = next.slots[key];
          next.slots[key] = {
            provider: target.provider,
            model: target.id,
            ...(requestedThinking === undefined
              ? {}
              : { thinking: effectiveThinkingLevel(target, requestedThinking) }),
            ...(label ? { label } : old?.label ? { label: old.label } : {}),
          };
        });
        refreshLegend(ctx);
        ctx.ui.notify(
          `Slot ${key} saved: ${effectivePresetDescription(target, requestedThinking, pi.getThinkingLevel())}`,
          "info",
        );
        return true;
      };

      try {
        let key = parsed.slot;
        while (true) {
          if (!alive(signal)) return;
          const config = readConfig(path);
          const rows = Array.from(
            { length: 9 },
            (_, i) => `${i + 1}: ${describe(config.slots[String(i + 1)])}`,
          );
          const modifierRow = `Modifier: ${config.modifier} (active: ${modifier})`;
          const modelNameStyleRow = `Model names: ${styleChoices[config.modelNameStyle ?? "short"]}`;
          const scrollRow = `Alt+wheel: ${config.altScroll ? "on" : "off"} (fullscreen model strip)`;
          const choice = key
            ? rows[Number(key) - 1]
            : await ctx.ui.select(
                "Model hotkeys — select a slot to configure",
                [...rows, modifierRow, modelNameStyleRow, scrollRow, "Done"],
                { signal },
              );
          if (!alive(signal) || !choice || choice === "Done") return;
          if (choice === scrollRow) {
            updateConfig(path, (next) => {
              next.altScroll = !next.altScroll;
            });
            refreshLegend(ctx);
            ctx.ui.notify(
              `Alt+wheel model switching ${config.altScroll ? "disabled" : "enabled"}.`,
              "info",
            );
            continue;
          }
          if (choice === modifierRow) {
            const selected = await ctx.ui.select(
              "Hotkey modifier (requires /reload)",
              [...modifiers],
              { signal },
            );
            if (!alive(signal)) return;
            if (selected) {
              updateConfig(path, (next) => (next.modifier = selected as Config["modifier"]));
              refreshLegend(ctx);
              ctx.ui.notify(
                "Modifier saved. Run /reload in each open session to activate it.",
                "info",
              );
            }
            continue;
          }
          if (choice === modelNameStyleRow) {
            const selected = await ctx.ui.select(
              "Model name style",
              modelNameStyles.map((style) => styleChoices[style]),
              { signal },
            );
            if (!alive(signal)) return;
            const style = modelNameStyles.find((candidate) => styleChoices[candidate] === selected);
            if (style) {
              updateConfig(path, (next) => (next.modelNameStyle = style));
              refreshLegend(ctx);
              ctx.ui.notify(`Model names now use the ${style} style.`, "info");
            }
            continue;
          }
          key = String(rows.indexOf(choice) + 1);
          const action = await ctx.ui.select(
            `Configure slot ${key}`,
            [
              "Choose model",
              "Use current model and thinking",
              "Copy preset from another slot",
              "Set/remove label",
              "Clear slot",
            ],
            { signal },
          );
          if (!alive(signal)) return;
          const old = readConfig(path).slots[key];
          if (action === "Clear slot") {
            updateConfig(path, (next) => delete next.slots[key!]);
            refreshLegend(ctx);
            ctx.ui.notify(`Slot ${key} cleared.`, "info");
          } else if (action === "Set/remove label") {
            const label = await ctx.ui.input(
              `Label for slot ${key} (blank removes it)`,
              old?.label ?? "",
              { signal },
            );
            if (!alive(signal)) return;
            if (label !== undefined) {
              const trimmed = label.trim();
              if (/[\u0000-\u001f\u007f]/.test(trimmed))
                ctx.ui.notify("Labels cannot contain control characters.", "warning");
              else if (old) {
                updateConfig(path, (next) => {
                  if (!next.slots[key!]) return;
                  if (trimmed) next.slots[key!].label = trimmed;
                  else delete next.slots[key!].label;
                });
                refreshLegend(ctx);
              } else ctx.ui.notify(`Slot ${key} is unassigned; choose a model first.`, "warning");
            }
          } else if (action === "Copy preset from another slot") {
            const sources = Object.entries(readConfig(path).slots)
              .filter(([sourceKey, source]) => sourceKey !== key && !!source)
              .map(([sourceKey, source]) => `${sourceKey}: ${describe(source)}`);
            if (!sources.length) ctx.ui.notify("No other assigned slots to copy.", "warning");
            else {
              const sourceChoice = await ctx.ui.select(`Copy preset to slot ${key}`, sources, {
                signal,
              });
              if (!alive(signal) || !sourceChoice) return;
              const sourceKey = sourceChoice.slice(0, 1);
              const source = readConfig(path).slots[sourceKey];
              if (source) {
                const sourceModel = ctx.modelRegistry.find(source.provider, source.model) as
                  | PickerModel
                  | undefined;
                await confirmAndSave(
                  key,
                  sourceModel ?? {
                    provider: source.provider,
                    id: source.model,
                    name: source.model,
                  },
                  source.thinking,
                  old?.label,
                );
              }
            }
          } else if (action === "Use current model and thinking") {
            const current = ctx.model as PickerModel | undefined;
            if (current) await confirmAndSave(key, current, pi.getThinkingLevel(), old?.label);
            else ctx.ui.notify("No model is selected.", "warning");
          } else if (action === "Choose model") {
            const target = await chooseModel(parsed.slot ? parsed.query : undefined);
            if (target) {
              const scopedLevel = scopedSnapshot(ctx).find(
                (entry) => modelKey(entry.model) === modelKey(target),
              )?.thinkingLevel;
              const choices = thinkingChoices(target, pi.getThinkingLevel(), scopedLevel);
              const selected = await ctx.ui.select(
                "Thinking level (supported by target model)",
                choices,
                { signal },
              );
              if (!alive(signal) || !selected) return;
              const keep = selected.startsWith("Keep current");
              const requested = keep
                ? undefined
                : levels.find((level) => selected.startsWith(level));
              if (requested === undefined && !keep) continue;
              await confirmAndSave(key, target, requested, old?.label);
            }
          }
          if (parsed.slot) return;
          key = undefined;
        }
      } catch (error) {
        if (alive(signal))
          ctx.ui.notify(`Cannot configure model hotkeys: ${error}. Config: ${path}`, "error");
      } finally {
        if (alive(signal)) {
          configuring = false;
          refreshLegend(ctx);
        }
      }
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerModelHotkeys(pi, join(getAgentDir(), "model-hotkeys.json"));
}
