import { type Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { levels, type Config, type Slot } from "./config.ts";
import { effectiveThinkingLevel, modelKey, type PickerModel } from "./model-picker.ts";

export function previewLegend(
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

export function legendModelLabel(
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

export type LegendOptions = {
  config: Config;
  modifier: Config["modifier"];
  current: PickerModel | undefined;
  currentThinking: (typeof levels)[number];
  findModel: (provider: string, model: string) => { name?: string } | undefined;
  theme: Pick<Theme, "fg">;
};

export function renderLegend(options: LegendOptions, width: number): string[] {
  const { config, modifier, current, currentThinking, findModel, theme } = options;
  if (width < 1) return [];
  const entries = Object.entries(config.slots).sort(([a], [b]) => Number(a) - Number(b));
  const labels = entries.map(([key, slot]) => {
    const active =
      current?.provider === slot.provider &&
      current?.id === slot.model &&
      (slot.thinking === undefined || slot.thinking === currentThinking);
    const modelLabel = legendModelLabel(config, key, slot, findModel);
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
}
