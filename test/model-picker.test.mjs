import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
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

test("empty queries reuse the ordered catalogue and filtering preserves unique sources", () => {
  const input = Object.freeze([...models, models[1]]);
  const picker = component({ models: input, scoped: false });
  const source = picker.visibleModels;
  assert.equal(source, picker.models);
  assert.equal(source.length, models.length);
  picker.handleInput("luna");
  assert.deepEqual(picker.visibleModels, filterModels(source, "luna"));
  picker.handleInput("\x15"); // Ctrl+U clears the query.
  assert.equal(picker.query, "");
  assert.equal(picker.visibleModels, source);
  picker.setModels(input);
  assert.equal(picker.visibleModels, picker.models);
  picker.dispose();
  assert.equal(input.length, 4);
  assert.equal(source.length, 3);

  const scoped = component({
    scopedModels: [{ model: models[1] }, { model: models[1] }],
  });
  assert.deepEqual(scoped.visibleModels, [models[1]]);
  scoped.handleInput("luna");
  assert.deepEqual(scoped.visibleModels, [models[1]]);
  scoped.dispose();
});

test("cursor-only input preserves filtered rows and selection", () => {
  let selected;
  const picker = component({ scoped: false, query: "luna" }, (key) => (selected = key));
  const rows = picker.visibleModels;
  picker.handleInput("down");
  picker.handleInput("\x1b[D");
  assert.equal(picker.query, "luna");
  assert.equal(picker.visibleModels, rows);
  picker.handleInput("enter");
  assert.equal(selected, "b\u0000same");
});

test("closing releases owned references and refresh listeners without mutating caller data", async () => {
  const lifecycle = new AbortController();
  let signal;
  let settle;
  let closed = 0;
  let refreshed = 0;
  const scopedModels = Object.freeze([{ model: models[1] }]);
  const picker = component(
    {
      lifecycle: lifecycle.signal,
      scopedModels,
      refresh: (value) => {
        signal = value;
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
      onRefresh: () => refreshed++,
    },
    () => closed++,
  );
  picker.handleInput("\x12");
  picker.dispose();
  picker.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(closed, 1);
  assert.deepEqual(picker.visibleModels, []);
  assert.deepEqual(picker.models, []);
  assert.deepEqual(picker.scopedModels, []);
  for (const field of ["current", "refresh", "onRefresh", "onScopeChange", "done"]) {
    assert.equal(picker[field], undefined);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getEventListeners(lifecycle.signal, "abort").length, 0);
  assert.equal(getEventListeners(signal, "abort").length, 0);
  assert.equal(picker.refreshController, undefined);
  settle({ models });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshed, 0);
  assert.deepEqual(picker.visibleModels, []);
  assert.equal(scopedModels.length, 1);
  assert.equal(models.length, 3);
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

for (const settlement of ["never", "resolve", "reject"]) {
  test(`refresh timeout releases an abort-ignoring callback (${settlement}) and permits retry`, async () => {
    let firstSignal;
    let resolveFirst;
    let rejectFirst;
    let calls = 0;
    const outcomes = [];
    const freshModels = [{ provider: "p", id: "fresh", name: "Fresh" }];
    const picker = component({
      scoped: false,
      refreshTimeoutMs: 1,
      refresh: (signal) => {
        calls++;
        if (calls > 1) return Promise.resolve({ models: freshModels, status: "retry ok" });
        firstSignal = signal;
        return new Promise((resolve, reject) => {
          resolveFirst = resolve;
          rejectFirst = reject;
        });
      },
      onRefresh: (outcome) => outcomes.push(outcome),
    });
    try {
      const cached = [...picker.visibleModels];
      picker.handleInput("\x12");
      picker.handleInput("\x12");
      assert.equal(calls, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(firstSignal.aborted, true);
      assert.match(picker.render(120).join("\n"), /Refresh timed out/);
      assert.deepEqual(picker.visibleModels, cached);
      assert.equal(outcomes.length, 0);

      picker.handleInput("\x12");
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, 2);
      assert.deepEqual(picker.visibleModels, freshModels);
      assert.equal(outcomes.length, 1);

      if (settlement === "resolve") resolveFirst({ models, status: "stale result" });
      if (settlement === "reject") rejectFirst(new Error("late failure"));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(picker.visibleModels, freshModels);
      assert.equal(outcomes.length, 1);
      assert.match(picker.render(120).join("\n"), /retry ok/);
    } finally {
      picker.dispose();
    }
  });
}

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
