import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  effectivePresetDescription,
  effectiveThinkingLevel,
  filterModels,
  ModelPickerComponent,
  modelInScope,
  orderModels,
  pickerRowText,
  supportedThinkingLevels,
  thinkingChoices,
} from "../extensions/model-picker.ts";

const models = [
  { provider: "z", id: "zeta", name: "Zeta", reasoning: true },
  { provider: "a", id: "gpt-luna", name: "Luna", reasoning: true },
  { provider: "b", id: "same", name: "Luna", reasoning: false },
];

const fakeKeys = {
  matches(data, key) {
    return (
      (key === "tui.input.tab" && data === "tab") ||
      (key === "tui.select.up" && data === "up") ||
      (key === "tui.select.down" && data === "down") ||
      (key === "tui.select.confirm" && data === "enter") ||
      (key === "tui.select.cancel" && data === "escape")
    );
  },
};

function component(options, done = () => {}) {
  return new ModelPickerComponent(
    {
      tui: { requestRender() {} },
      theme: { fg: (_color, text) => text, bold: (text) => text },
      keybindings: fakeKeys,
      models,
      scopedModels: [{ model: models[1], thinkingLevel: "high" }],
      scoped: true,
      ...options,
    },
    done,
  );
}

test("model search uses name, provider, and ID and ordering prioritizes current then slots", () => {
  assert.deepEqual(
    filterModels(models, "luna").map((model) => model.id),
    ["gpt-luna", "same"],
  );
  assert.deepEqual(
    filterModels(models, "b same").map((model) => model.id),
    ["same"],
  );
  assert.deepEqual(
    orderModels(models, {
      current: models[2],
      slots: { 3: { provider: "z", model: "zeta" }, 1: { provider: "a", model: "gpt-luna" } },
    }).map((model) => model.id),
    ["same", "gpt-luna", "zeta"],
  );
});

test("scope, markers, prefilled query, Tab, and width-safe rendering work", () => {
  assert.equal(modelInScope(models[1], [{ model: models[1], thinkingLevel: "high" }]), true);
  assert.equal(modelInScope(models[0], [{ model: models[1] }]), false);
  const row = pickerRowText(models[1], {
    current: models[1],
    slots: { 2: { provider: "a", model: "gpt-luna" } },
    scopedThinking: "high",
  });
  assert.match(row, /current/);
  assert.match(row, /slots 2/);
  assert.match(row, /reasoning/);
  assert.match(row, /scope-pinned thinking high/);
  let selected;
  const picker = component({ query: "luna" }, (key) => (selected = key));
  assert.equal(picker.query, "luna");
  assert.equal(picker.visibleModels.length, 1);
  assert.ok(picker.render(18).every((line) => visibleWidth(line) <= 18));
  picker.handleInput("tab");
  assert.equal(picker.isScoped, false);
  assert.equal(picker.query, "luna");
  picker.handleInput("enter");
  assert.equal(selected, "a\u0000gpt-luna");
  picker.dispose();
});

test("refresh keeps cached rows, reports completion, and lifecycle abort closes", async () => {
  let refreshSignal;
  let refreshed;
  const picker = component({
    refresh: async (signal) => {
      refreshSignal = signal;
      return { models: [{ ...models[0], id: "new" }], status: "refresh ok" };
    },
    onRefresh: (outcome) => (refreshed = outcome.models[0].id),
  });
  picker.handleInput("\x12");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshed, "new");
  assert.match(picker.render(80).join("\n"), /refresh ok/);
  assert.equal(refreshSignal.aborted, false);
  const controller = new AbortController();
  let closed;
  const abortedPicker = component({ lifecycle: controller.signal }, (key) => (closed = key));
  controller.abort();
  assert.equal(closed, undefined);
  abortedPicker.dispose();
});

test("refresh errors remain visible without discarding cached rows", async () => {
  const picker = component({
    refresh: async () => {
      throw new Error("provider unavailable");
    },
  });
  picker.handleInput("\x12");
  await new Promise((resolve) => setImmediate(resolve));
  const text = picker.render(120).join("\n");
  assert.match(text, /Refresh failed: provider unavailable/);
  assert.match(text, /Luna/);
  picker.dispose();
});

test("refresh timeout keeps cached rows and reports the timeout", async () => {
  const picker = component({
    refreshTimeoutMs: 1,
    refresh: (signal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve({ models }), { once: true }),
      ),
  });
  picker.handleInput("\x12");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const text = picker.render(120).join("\n");
  assert.match(text, /Refresh timed out/);
  assert.match(text, /Luna/);
  picker.dispose();
});

test("picker distinguishes empty scope, empty authenticated catalogue, and no search matches", () => {
  const scopedEmpty = component({ models: [], scopedModels: [], scoped: true });
  assert.match(scopedEmpty.render(100).join("\n"), /current scope/);
  const allEmpty = component({ models: [], scopedModels: [], scoped: false });
  assert.match(allEmpty.render(100).join("\n"), /authenticated available models/);
  const noMatches = component({ models, scopedModels: [], scoped: false, query: "missing" });
  assert.match(noMatches.render(100).join("\n"), /No search matches/);
  allEmpty.handleInput("tab");
  assert.equal(allEmpty.isScoped, false);
  assert.match(allEmpty.render(100).join("\n"), /No session model scope/);
});

test("thinking choices follow effective current, pinned, then supported order", () => {
  const model = {
    provider: "p",
    id: "m",
    reasoning: true,
    thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: null },
  };
  assert.deepEqual(supportedThinkingLevels(model), ["off", "low", "medium", "high", "xhigh"]);
  assert.equal(effectiveThinkingLevel(model, "max"), "xhigh");
  const choices = thinkingChoices(model, "high", "low");
  assert.match(choices[0], /Keep current.*high/);
  assert.match(choices[1], /^high .*current/);
  assert.match(choices[2], /^low .*scope-pinned/);
  assert.match(effectivePresetDescription(model, undefined, "high"), /effective: high/);
});
