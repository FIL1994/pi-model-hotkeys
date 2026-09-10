import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PickerModel, RefreshOutcome, ScopedPickerModel } from "./model-picker.ts";

type CatalogueRegistry = Pick<
  ExtensionContext["modelRegistry"],
  "getAvailable" | "find" | "refresh"
>;

export function scopedSnapshot(ctx: Pick<ExtensionContext, "scopedModels">): ScopedPickerModel[] {
  return [...(ctx.scopedModels ?? [])] as ScopedPickerModel[];
}

/** Refresh registry data without owning picker state or session lifetime. */
export async function refreshCatalogue(
  registry: CatalogueRegistry,
  scoped: readonly ScopedPickerModel[],
  refreshSignal: AbortSignal,
  lifecycleSignal: AbortSignal,
): Promise<RefreshOutcome<PickerModel>> {
  const cached = registry.getAvailable() as PickerModel[];
  const cancelled = () => refreshSignal.aborted || lifecycleSignal.aborted;
  try {
    const result = await registry.refresh({
      allowNetwork: true,
      force: true,
      signal: refreshSignal,
    });
    if (cancelled()) return { models: cached, status: "Refresh cancelled" };
    const models = registry.getAvailable() as PickerModel[];
    const scopedModels = scoped.map((entry) => ({
      ...entry,
      model: (registry.find(entry.model.provider, entry.model.id) ?? entry.model) as PickerModel,
    }));
    const errors = result.errors?.size ?? 0;
    return {
      models,
      scopedModels,
      status:
        result.aborted || refreshSignal.aborted
          ? "Refresh cancelled"
          : errors
            ? `Refresh partially completed (${errors} provider error${errors === 1 ? "" : "s"}); cached models remain available`
            : "Model catalogue refreshed successfully",
    };
  } catch (error) {
    if (cancelled()) return { models: cached, status: "Refresh cancelled" };
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || /timed? ?out|timeout/i.test(error.message))
    ) {
      return { models: cached, status: "Refresh timed out; cached models remain available" };
    }
    return {
      models: cached,
      status: `Refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
