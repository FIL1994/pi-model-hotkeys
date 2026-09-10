import {
  Container,
  fuzzyFilter,
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import { levels, type Slot } from "./config.ts";

export type PickerModel = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<(typeof levels)[number], string | null>>;
};

export type ScopedPickerModel = {
  model: PickerModel;
  thinkingLevel?: (typeof levels)[number];
};

export const modelKey = (model: Pick<PickerModel, "provider" | "id">): string =>
  `${model.provider}\u0000${model.id}`;

export function modelDisplayName(model: PickerModel): string {
  return model.name?.trim() || model.id;
}

export function modelSearchText(model: PickerModel): string {
  return `${modelDisplayName(model)} ${model.provider} ${model.id}`;
}

export function uniqueModels<T extends PickerModel>(models: readonly T[]): T[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = modelKey(model);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function filterModels<T extends PickerModel>(models: readonly T[], query: string): T[] {
  const unique = uniqueModels(models);
  const trimmed = query.trim();
  return trimmed ? fuzzyFilter(unique, trimmed, modelSearchText) : unique;
}

export function orderModels<T extends PickerModel>(
  models: readonly T[],
  options: {
    current?: PickerModel;
    slots?: Record<string, Slot>;
  } = {},
): T[] {
  const currentKey = options.current ? modelKey(options.current) : undefined;
  const assigned = new Map<string, number>();
  for (const [slot, value] of Object.entries(options.slots ?? {})) {
    const key = modelKey({ provider: value.provider, id: value.model });
    assigned.set(key, Number(slot));
  }
  return uniqueModels(models).sort((a, b) => {
    const rank = (model: PickerModel) =>
      modelKey(model) === currentKey ? 0 : assigned.has(modelKey(model)) ? 1 : 2;
    return (
      rank(a) - rank(b) ||
      modelDisplayName(a).localeCompare(modelDisplayName(b)) ||
      a.provider.localeCompare(b.provider) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function modelInScope(
  model: Pick<PickerModel, "provider" | "id">,
  scopedModels: readonly ScopedPickerModel[],
): boolean {
  return scopedModels.some((entry) => modelKey(entry.model) === modelKey(model));
}

/** Mirrors @earendil-works/pi-ai's getSupportedThinkingLevels semantics. */
export function supportedThinkingLevels(model: PickerModel): (typeof levels)[number][] {
  // Real Pi models always provide this boolean. Treat an omitted value as the
  // permissive shape used by older test/RPC fixtures; an explicit false is the
  // non-reasoning case.
  if (model.reasoning === false) return ["off"];
  return levels.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    return level !== "xhigh" && level !== "max" ? true : mapped !== undefined;
  });
}

/** Mirrors @earendil-works/pi-ai's clampThinkingLevel semantics. */
export function effectiveThinkingLevel(
  model: PickerModel,
  requested: (typeof levels)[number],
): (typeof levels)[number] {
  const available = supportedThinkingLevels(model);
  if (available.includes(requested)) return requested;
  const index = levels.indexOf(requested);
  for (let i = index; i < levels.length; i++) if (available.includes(levels[i])) return levels[i];
  for (let i = index - 1; i >= 0; i--) if (available.includes(levels[i])) return levels[i];
  return available[0] ?? "off";
}

export function thinkingChoices(
  model: PickerModel,
  currentLevel: (typeof levels)[number],
  scopedLevel?: (typeof levels)[number],
): string[] {
  const supported = supportedThinkingLevels(model);
  const current = effectiveThinkingLevel(model, currentLevel);
  const ordered = [current, scopedLevel, ...supported].filter(
    (level, index, all): level is (typeof levels)[number] =>
      typeof level === "string" && supported.includes(level) && all.indexOf(level) === index,
  );
  const keep = `Keep current (effective: ${current})`;
  return [
    keep,
    ...ordered.map(
      (level) =>
        `${level}${level === current ? " — current" : ""}${level === scopedLevel ? " — scope-pinned" : ""}`,
    ),
  ];
}

export function effectivePresetDescription(
  model: PickerModel,
  requested: (typeof levels)[number] | undefined,
  currentLevel: (typeof levels)[number],
): string {
  return requested === undefined
    ? `Keep current (effective: ${effectiveThinkingLevel(model, currentLevel)})`
    : `${requested} (effective: ${effectiveThinkingLevel(model, requested)})`;
}

export function pickerRowText(
  model: PickerModel,
  options: {
    current?: PickerModel;
    slots?: Record<string, Slot>;
    scopedThinking?: (typeof levels)[number];
  } = {},
): string {
  const slots = Object.entries(options.slots ?? {})
    .filter(([, slot]) => modelKey({ provider: slot.provider, id: slot.model }) === modelKey(model))
    .map(([slot]) => slot)
    .sort((a, b) => Number(a) - Number(b));
  const markers = [
    options.current && modelKey(options.current) === modelKey(model) ? "current" : "",
    slots.length ? `slots ${slots.join(",")}` : "",
    model.reasoning ? "reasoning" : "",
    options.scopedThinking !== undefined ? `scope-pinned thinking ${options.scopedThinking}` : "",
  ].filter(Boolean);
  const markerText = markers.length ? ` [${markers.join("; ")}]` : "";
  return `${modelDisplayName(model)} — ${model.provider}/${model.id}${markerText}`;
}

export function flatModelChoices(
  models: readonly PickerModel[],
  options: {
    current?: PickerModel;
    slots?: Record<string, Slot>;
    scopedThinking?: Map<string, string | undefined>;
  } = {},
): string[] {
  return orderModels(models, options).map((model) =>
    pickerRowText(model, {
      current: options.current,
      slots: options.slots,
      scopedThinking: options.scopedThinking?.get(modelKey(model)) as
        | (typeof levels)[number]
        | undefined,
    }),
  );
}

export type RefreshOutcome<T extends PickerModel> = {
  models: T[];
  scopedModels?: ScopedPickerModel[];
  status?: string;
};

export type ModelPickerOptions<T extends PickerModel> = {
  tui: TUI;
  theme: { fg(color: string, text: string): string; bold(text: string): string };
  keybindings: KeybindingsManager;
  models: readonly T[];
  scopedModels: readonly ScopedPickerModel[];
  scoped: boolean;
  query?: string;
  current?: T;
  slots?: Record<string, Slot>;
  lifecycle?: AbortSignal;
  refresh?: (signal: AbortSignal) => Promise<RefreshOutcome<T>>;
  refreshTimeoutMs?: number;
  onScopeChange?: (scoped: boolean) => void;
  onRefresh?: (outcome: RefreshOutcome<T>) => void;
};

/** A small public-API-only searchable model picker used by ctx.ui.custom(). */
export class ModelPickerComponent<T extends PickerModel> extends Container implements Component {
  private readonly tui: TUI;
  private readonly theme: ModelPickerOptions<T>["theme"];
  private readonly keybindings: KeybindingsManager;
  private readonly input: Input;
  private readonly done: (key: string | undefined) => void;
  private readonly refresh?: ModelPickerOptions<T>["refresh"];
  private readonly refreshTimeoutMs: number;
  private readonly lifecycle?: AbortSignal;
  private readonly abortHandler?: () => void;
  private models: T[];
  private scopedModels: ScopedPickerModel[];
  private scoped: boolean;
  private current?: T;
  private slots: Record<string, Slot>;
  private filtered: T[] = [];
  private selectedIndex = 0;
  private status = "";
  private closed = false;
  private refreshing = false;
  private refreshController?: AbortController;
  private _focused = false;
  private onScopeChange?: (scoped: boolean) => void;
  private onRefresh?: (outcome: RefreshOutcome<T>) => void;

  constructor(options: ModelPickerOptions<T>, done: (key: string | undefined) => void) {
    super();
    this.tui = options.tui;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.input = new Input({ prompt: "> ", placeholder: "Search name, provider, or model ID" });
    this.done = done;
    this.refresh = options.refresh;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? 15_000;
    this.lifecycle = options.lifecycle;
    this.models = orderModels(options.models, { current: options.current, slots: options.slots });
    this.scopedModels = [...options.scopedModels];
    this.scoped = options.scoped;
    this.current = options.current;
    this.slots = options.slots ?? {};
    this.onScopeChange = options.onScopeChange;
    this.onRefresh = options.onRefresh;
    this.input.setValue(options.query ?? "");
    this.input.onSubmit = () => this.choose();
    this.filter();
    if (this.lifecycle) {
      const abortHandler = () => this.close(undefined);
      this.abortHandler = abortHandler;
      this.lifecycle.addEventListener("abort", abortHandler, { once: true });
      if (this.lifecycle.aborted) abortHandler();
    }
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  get query(): string {
    return this.input.getValue();
  }

  get isScoped(): boolean {
    return this.scoped;
  }

  get visibleModels(): readonly T[] {
    return this.filtered;
  }

  setModels(models: readonly T[], scopedModels?: readonly ScopedPickerModel[]): void {
    if (this.closed) return;
    this.models = orderModels(models, { current: this.current, slots: this.slots });
    if (scopedModels) this.scopedModels = [...scopedModels];
    this.filter();
    this.tui.requestRender();
  }

  private sourceModels(): T[] {
    if (!this.scoped) return this.models;
    return orderModels(uniqueModels(this.scopedModels.map((entry) => entry.model) as T[]), {
      current: this.current,
      slots: this.slots,
    });
  }

  private filter(): void {
    this.filtered = filterModels(this.sourceModels(), this.query);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
  }

  private choose(): void {
    const selected = this.filtered[this.selectedIndex];
    if (selected) this.close(modelKey(selected));
  }

  private close(key: string | undefined): void {
    if (this.closed) return;
    this.closed = true;
    this.refreshController?.abort();
    if (this.lifecycle && this.abortHandler) {
      this.lifecycle.removeEventListener("abort", this.abortHandler);
    }
    this.done(key);
  }

  private async runRefresh(): Promise<void> {
    if (!this.refresh || this.refreshing || this.closed) return;
    this.refreshing = true;
    this.status = "Refreshing model catalogue… cached models remain visible";
    this.tui.requestRender();
    const controller = new AbortController();
    this.refreshController = controller;
    let timedOut = false;
    let rejectAborted!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = () => reject(new Error("Refresh aborted"));
      controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.refreshTimeoutMs);
    const unlink = () => controller.abort();
    this.lifecycle?.addEventListener("abort", unlink, { once: true });
    try {
      // Stop waiting even if the callback ignores cancellation. Late settlements
      // are consumed by the race and cannot update this picker or a later refresh.
      const outcome = await Promise.race([this.refresh(controller.signal), aborted]);
      if (this.closed || this.lifecycle?.aborted) return;
      if (timedOut) {
        this.status = "Refresh timed out; cached models remain available";
        return;
      }
      if (controller.signal.aborted) return;
      this.models = orderModels(outcome.models, { current: this.current, slots: this.slots });
      if (outcome.scopedModels) this.scopedModels = outcome.scopedModels;
      this.status = outcome.status ?? "Model catalogue refreshed";
      this.filter();
      this.onRefresh?.(outcome);
    } catch (error) {
      if (this.closed || this.lifecycle?.aborted) return;
      if (timedOut) {
        this.status = "Refresh timed out; cached models remain available";
        return;
      }
      if (controller.signal.aborted) return;
      this.status = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", rejectAborted);
      this.lifecycle?.removeEventListener("abort", unlink);
      if (!this.closed) {
        this.refreshing = false;
        this.tui.requestRender();
      }
      if (this.refreshController === controller) this.refreshController = undefined;
    }
  }

  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, "ctrl+r")) {
      void this.runRefresh();
      return;
    }
    if (this.keybindings.matches(data, "tui.input.tab")) {
      if (!this.scopedModels.length) {
        this.status = "No session model scope is configured";
        this.tui.requestRender();
        return;
      }
      this.scoped = !this.scoped;
      this.status = this.scoped ? "Scoped models" : "All authenticated models";
      this.selectedIndex = 0;
      this.filter();
      this.onScopeChange?.(this.scoped);
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up")) {
      if (this.filtered.length)
        this.selectedIndex = (this.selectedIndex - 1 + this.filtered.length) % this.filtered.length;
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      if (this.filtered.length)
        this.selectedIndex = (this.selectedIndex + 1) % this.filtered.length;
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      this.choose();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(undefined);
      return;
    }
    this.input.handleInput(data);
    this.selectedIndex = 0;
    this.filter();
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (width < 1) return [];
    const mode = this.scoped ? "scoped" : "all authenticated";
    const header = this.theme.fg("accent", this.theme.bold(`Choose model (${mode})`));
    const lines = [truncateToWidth(header, width, ""), ...this.input.render(width)];
    if (this.status) lines.push(this.theme.fg("warning", truncateToWidth(this.status, width, "…")));
    if (this.filtered.length === 0) {
      const empty = this.query.trim()
        ? "No search matches."
        : this.scoped
          ? "No models in the current scope. Tab for all authenticated models."
          : "No authenticated available models. Configure authentication with /login.";
      lines.push(this.theme.fg("muted", truncateToWidth(empty, width, "…")));
    } else {
      const maxVisible = 12;
      const start = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(maxVisible / 2),
          this.filtered.length - maxVisible,
        ),
      );
      const end = Math.min(start + maxVisible, this.filtered.length);
      const pinned = new Map(
        this.scopedModels.map((entry) => [modelKey(entry.model), entry.thinkingLevel]),
      );
      for (let index = start; index < end; index++) {
        const model = this.filtered[index];
        const row = pickerRowText(model, {
          current: this.current,
          slots: this.slots,
          scopedThinking: pinned.get(modelKey(model)),
        });
        const prefix = index === this.selectedIndex ? "› " : "  ";
        const styled =
          index === this.selectedIndex
            ? this.theme.fg("accent", `${prefix}${row}`)
            : `${prefix}${row}`;
        lines.push(truncateToWidth(styled, width, "…"));
      }
      if (start > 0 || end < this.filtered.length) {
        lines.push(
          this.theme.fg(
            "dim",
            truncateToWidth(`  (${this.selectedIndex + 1}/${this.filtered.length})`, width, ""),
          ),
        );
      }
    }
    const footer = "↑/↓ select · Enter choose · Tab scope · Ctrl+R refresh · Esc cancel";
    lines.push(this.theme.fg("dim", truncateToWidth(footer, width, "…")));
    return lines.map((line) =>
      visibleWidth(line) <= width ? line : truncateToWidth(line, width, ""),
    );
  }

  invalidate(): void {
    this.input.invalidate();
    this.tui.requestRender();
  }

  dispose(): void {
    this.close(undefined);
  }
}
