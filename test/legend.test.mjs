import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  compactModelName,
  legendModelLabel,
  previewLegend,
  renderLegend,
} from "../extensions/legend.ts";

const model = (provider, id, name = id) => ({ provider, id, name });
const plainTheme = { fg: (_color, text) => text };
const find = (models) => (provider, id) =>
  models.find((m) => m.provider === provider && m.id === id);

test("compact names and naming styles handle collisions", () => {
  assert.equal(compactModelName("openai/gpt-5.6-luna"), "luna");
  const config = {
    modifier: "alt",
    modelNameStyle: "compact",
    slots: {
      1: { provider: "a", model: "foo-alpha-1" },
      2: { provider: "b", model: "foo-beta-1" },
      3: { provider: "a", model: "foo-alpha-2" },
    },
  };
  assert.equal(
    legendModelLabel(config, "1", config.slots[1], () => undefined),
    "a/foo-alpha-1",
  );
  assert.equal(
    legendModelLabel(config, "2", config.slots[2], () => undefined),
    "foo-beta",
  );
  assert.equal(
    legendModelLabel({ ...config, modelNameStyle: "friendly" }, "1", config.slots[1], () => ({
      name: "Same",
    })),
    "Same — a/foo-alpha-1",
  );
});

test("preview uses effective thinking and marks the active target", () => {
  const m = model("p", "m");
  assert.match(
    previewLegend("1", { provider: "p", model: "m" }, m, m, "medium", "ctrl", "Model"),
    /^● ctrl\+1 Model/,
  );
  assert.match(
    previewLegend(
      "1",
      { provider: "p", model: "m", thinking: "high" },
      m,
      m,
      "medium",
      "ctrl",
      "Model",
    ),
    /\(high\).*effective thinking: high$/,
  );
});

test("render handles active markers, pending modifiers, empty and narrow output", () => {
  const config = {
    modifier: "ctrl",
    modelNameStyle: "friendly",
    slots: { 1: { provider: "p", model: "m", thinking: "high" } },
  };
  const options = {
    config,
    modifier: "alt",
    current: model("p", "m"),
    currentThinking: "high",
    findModel: find([model("p", "m", "Friendly")]),
    theme: plainTheme,
  };
  assert.deepEqual(renderLegend(options, 200), ["● alt+1 Friendly (high)  [ctrl pending /reload]"]);
  assert.deepEqual(
    renderLegend({ ...options, config: { modifier: "alt", slots: {} }, modifier: "alt" }, 200),
    ["Model hotkeys: no slots assigned — /model-hotkeys"],
  );
  assert.deepEqual(renderLegend(options, 0), []);
  for (const width of [1, 8, 20]) {
    const lines = renderLegend(options, width);
    assert.ok(lines.length > 1);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }
  assert.ok(!renderLegend({ ...options, currentThinking: "low" }, 200)[0].startsWith("●"));
});

test("preview clamps unsupported thinking before deciding the active marker", () => {
  const current = { ...model("p", "m"), reasoning: false };
  const slot = { provider: "p", model: "m", thinking: "high" };
  assert.equal(
    previewLegend("1", slot, current, current, "off", "alt", "Model"),
    "● alt+1 Model (high) — effective thinking: off",
  );
});
