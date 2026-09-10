import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, updateConfig } from "../extensions/config.ts";
import { registerModelHotkeys } from "../extensions/model-hotkeys.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "pi-hotkeys-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "config.json");
  const shortcuts = new Map();
  const commands = new Map();
  const notifications = [];
  const selections = [];
  const changes = [];
  const watcherCallbacks = [];
  const events = new Map();
  let widget;
  const model = { provider: "openai-codex", id: "gpt-5.6-luna" };
  let thinking = "medium";
  const pi = {
    on: (name, handler) => events.set(name, handler),
    registerShortcut: (key, value) => shortcuts.set(key, value),
    registerCommand: (key, value) => commands.set(key, value),
    setModel: async value => { changes.push(value); return true; },
    getThinkingLevel: () => thinking,
    setThinkingLevel: value => { thinking = value; },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    isIdle: () => true,
    model,
    modelRegistry: {
      find: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
      getAvailable: () => [model],
    },
    ui: {
      setWidget: (name, factory, options) => {
        assert.equal(name, "model-hotkeys");
        if (factory) assert.equal(options.placement, "belowEditor");
        widget = typeof factory === "function" ? factory({}, { fg: (_color, text) => text }) : factory;
      },
      notify: (...args) => notifications.push(args),
      select: async (_title, options) => {
        const selection = selections.shift();
        return typeof selection === "number" ? options[selection] : selection;
      },
      input: async () => selections.shift(),
    },
  };
  const register = () => registerModelHotkeys(pi, path, (_path, _options, listener) => {
    watcherCallbacks.push(listener);
    return () => { const index = watcherCallbacks.indexOf(listener); if (index >= 0) watcherCallbacks.splice(index, 1); };
  });
  register();
  t.after(() => events.get("session_shutdown")?.({}, ctx));
  return { path, pi, ctx, shortcuts, commands, notifications, selections, changes, register,
    triggerWatch: () => watcherCallbacks.forEach(listener => listener()),
    emit: name => events.get(name)?.({}, ctx),
    legend: (width = 1000) => Array.isArray(widget) ? widget : widget?.render(width),
    configure: args => commands.get("model-hotkeys").handler(args, ctx),
    press: key => shortcuts.get(key).handler(ctx),
  };
}

test("labels can be set, preserved on reassignment, and removed", async t => {
  const f = fixture(t);
  f.selections.push("Use current model and thinking");
  await f.configure("1");
  f.selections.push("Set/remove label", "  Deep  ");
  await f.configure("1");
  assert.equal(readConfig(f.path).slots[1].label, "Deep");
  assert.match(f.legend().join(""), /Deep/);
  f.selections.push("Use current model and thinking");
  await f.configure("1");
  assert.equal(readConfig(f.path).slots[1].label, "Deep");
  f.selections.push("Set/remove label", "");
  await f.configure("1");
  assert.equal(readConfig(f.path).slots[1].label, undefined);
});

test("shutdown prevents pending switch from applying thinking or notifying", async t => {
  const f = fixture(t);
  updateConfig(f.path, c => { c.slots[1] = { ...f.ctx.model, model: f.ctx.model.id, thinking: "high" }; });
  let resolve;
  f.pi.setModel = () => new Promise(r => { resolve = r; });
  const pending = f.press("alt+1");
  f.emit("session_shutdown");
  resolve(true);
  await pending;
  assert.equal(f.pi.getThinkingLevel(), "medium");
  assert.deepEqual(f.notifications, []);
});

test("shutdown aborts pending configuration without saving", async t => {
  const f = fixture(t);
  let resolve, signal;
  f.ctx.ui.select = (_title, _options, options) => {
    signal = options.signal;
    return new Promise(r => { resolve = r; });
  };
  const pending = f.configure("1");
  f.emit("session_shutdown");
  assert.equal(signal.aborted, true);
  resolve("Use current model and thinking");
  await pending;
  assert.deepEqual(readConfig(f.path).slots, {});
  assert.deepEqual(f.notifications, []);
});

test("invalid updates preserve the original config", t => {
  const f = fixture(t);
  updateConfig(f.path, c => { c.slots[1] = { provider: "p", model: "m" }; });
  const original = readFileSync(f.path, "utf8");
  for (const invalid of [{ provider: " p" }, { model: "m " }, { label: "bad\u001b" }, { label: 42 }]) {
    assert.throws(() => updateConfig(f.path, c => Object.assign(c.slots[1], invalid)));
    assert.equal(readFileSync(f.path, "utf8"), original);
  }
});

test("picker only offers supported thinking levels", async t => {
  const f = fixture(t);
  f.ctx.model.reasoning = true;
  f.ctx.model.thinkingLevelMap = { minimal: null, xhigh: "xhigh" };
  f.selections.push("Choose model", f.ctx.model.provider, f.ctx.model.id);
  const select = f.ctx.ui.select;
  f.ctx.ui.select = (title, options, settings) => {
    if (title.startsWith("Thinking level")) {
      assert.deepEqual(options, ["Keep current", "off", "low", "medium", "high", "xhigh"]);
      return Promise.resolve(undefined);
    }
    return select(title, options, settings);
  };
  await f.configure("1");
  assert.deepEqual(readConfig(f.path).slots, {});
});

test("registers all nine keys; unassigned slots do not switch", async t => {
  const f = fixture(t);
  assert.deepEqual([...f.shortcuts.keys()], Array.from({ length: 9 }, (_, i) => `alt+${i + 1}`));
  await f.press("alt+1");
  assert.equal(f.changes.length, 0);
  assert.match(f.notifications[0][0], /unassigned/);
});

test("legend appears at startup and refreshes after saving, switching, and clearing", async t => {
  const f = fixture(t);
  f.emit("session_start");
  assert.match(f.legend().join(""), /no slots assigned.*\/model-hotkeys/);
  f.selections.push("Use current model and thinking");
  await f.configure("3");
  assert.match(f.legend().join(""), /● alt\+3 gpt-5.6-luna \(medium\)/);
  f.ctx.model = { provider: "other", id: "other" };
  f.emit("model_select");
  assert.doesNotMatch(f.legend().join(""), /●/);
  f.selections.push("Clear slot");
  await f.configure("3");
  assert.match(f.legend().join(""), /no slots assigned/);
  f.emit("session_shutdown");
  assert.equal(f.legend(), undefined);
});

test("legend wraps all nine slots and shows active, not pending, modifier", async t => {
  const f = fixture(t);
  updateConfig(f.path, c => {
    for (let i = 1; i <= 9; i++) c.slots[i] = { provider: "provider", model: `model-${i}` };
    c.modifier = "ctrl";
  });
  f.emit("model_select");
  const lines = f.legend(35);
  assert.ok(lines.length > 1);
  assert.ok(lines.every(line => visibleWidth(line) <= 35));
  const text = lines.join(" ");
  for (let i = 1; i <= 9; i++) assert.match(text, new RegExp(`alt\\+${i}`));
  assert.match(text, /ctrl pending \/reload/);
});

test("legend picks up external config edits and cleans up its watcher", async t => {
  const f = fixture(t);
  f.emit("session_start");
  updateConfig(f.path, c => { c.slots[4] = { provider: "external", model: "new-model" }; });
  f.triggerWatch();
  assert.match(f.legend().join(""), /alt\+4 new-model/);
  f.emit("session_shutdown");
  assert.equal(f.legend(), undefined);
});

test("legend does not create TUI widgets in non-TUI modes", t => {
  const f = fixture(t);
  f.ctx.mode = "rpc";
  f.emit("session_start");
  assert.equal(f.legend(), undefined);
});

test("legend highlights exact thinking presets and keep-current slots", t => {
  const f = fixture(t);
  updateConfig(f.path, c => {
    const slot = { provider: "openai-codex", model: "gpt-5.6-luna" };
    c.slots[1] = { ...slot, thinking: "medium" };
    c.slots[2] = { ...slot, thinking: "high" };
    c.slots[3] = slot;
  });
  f.emit("model_select");
  let text = f.legend().join("");
  assert.match(text, /● alt\+1/);
  assert.doesNotMatch(text, /● alt\+2/);
  assert.match(text, /● alt\+3/);
  f.pi.setThinkingLevel("high");
  f.emit("thinking_level_select");
  text = f.legend().join("");
  assert.doesNotMatch(text, /● alt\+1/);
  assert.match(text, /● alt\+2/);
  assert.match(text, /● alt\+3/);
});

test("compact labels qualify provider collisions without shortening model IDs", t => {
  const f = fixture(t);
  updateConfig(f.path, c => {
    c.slots[1] = { provider: "openai-codex", model: "gpt-5.6-luna" };
    c.slots[2] = { provider: "openai", model: "gpt-5.6-luna" };
    c.slots[3] = { provider: "local", model: "namespace/unique-model" };
  });
  f.emit("model_select");
  const text = f.legend().join("");
  assert.match(text, /● alt\+1 openai-codex\/gpt-5.6-luna/);
  assert.match(text, /alt\+2 openai\/gpt-5.6-luna/);
  assert.doesNotMatch(text, /● alt\+2/);
  assert.match(text, /alt\+3 namespace\/unique-model/);
  assert.doesNotMatch(text, /local\//);
});

test("configure current model, persist, switch, and clear", async t => {
  const f = fixture(t);
  f.selections.push("Use current model and thinking");
  await f.configure("3");
  assert.equal(readConfig(f.path).slots[3].model, f.ctx.model.id);
  f.pi.setThinkingLevel("low");
  await f.press("alt+3");
  assert.deepEqual(f.changes, [f.ctx.model]);
  assert.equal(f.pi.getThinkingLevel(), "medium");
  f.selections.push("Clear slot");
  await f.configure("3");
  assert.equal(readConfig(f.path).slots[3], undefined);
});

test("model picker supports explicit thinking and cancellation", async t => {
  const f = fixture(t);
  f.selections.push("Choose model", "openai-codex", "gpt-5.6-luna", "high");
  await f.configure("9");
  await f.press("alt+9");
  assert.equal(f.pi.getThinkingLevel(), "high");
  const before = readFileSync(f.path, "utf8");
  f.selections.push("Choose model", "openai-codex", "gpt-5.6-luna", undefined);
  await f.configure("9");
  assert.equal(readFileSync(f.path, "utf8"), before);
});

test("keep current thinking does not reset it", async t => {
  const f = fixture(t);
  f.selections.push("Choose model", "openai-codex", "gpt-5.6-luna", "Keep current");
  await f.configure("1");
  f.pi.setThinkingLevel("low");
  await f.press("alt+1");
  assert.equal(f.pi.getThinkingLevel(), "low");
});

test("busy, missing-model, and auth failures leave thinking unchanged", async t => {
  const f = fixture(t);
  updateConfig(f.path, c => { c.slots[1] = { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "high" }; });
  f.ctx.isIdle = () => false;
  await f.press("alt+1");
  assert.equal(f.changes.length, 0);
  f.ctx.isIdle = () => true;
  f.pi.setModel = async () => false;
  await f.press("alt+1");
  assert.equal(f.pi.getThinkingLevel(), "medium");
  assert.match(f.notifications.at(-1)[0], /Authentication/);
  f.ctx.modelRegistry.find = () => undefined;
  await f.press("alt+1");
  assert.match(f.notifications.at(-1)[0], /not found/);
});

test("modifier is saved and registered on reload", async t => {
  const f = fixture(t);
  f.selections.push(9, "ctrl+alt", "Done");
  await f.configure("");
  assert.equal(readConfig(f.path).modifier, "ctrl+alt");
  assert.ok(f.shortcuts.has("alt+1"));
  f.shortcuts.clear();
  f.register();
  assert.ok(f.shortcuts.has("ctrl+alt+1"));
});

test("invalid config is preserved and errors are reported", async t => {
  const f = fixture(t);
  for (const text of ["{broken", '{"modifier":"alt","slots":{"0":{}}}', '{"modifier":"invalid","slots":{}}']) {
    writeFileSync(f.path, text);
    assert.throws(() => updateConfig(f.path, c => { c.slots = {}; }));
    await f.configure("1");
    await f.press("alt+1");
    assert.equal(readFileSync(f.path, "utf8"), text);
    assert.equal(f.notifications.at(-1)[1], "error");
  }
});

test("fresh edits preserve other slots and invalid arguments are rejected", async t => {
  const f = fixture(t);
  updateConfig(f.path, c => { c.slots[2] = { provider: "other", model: "model/with/slashes" }; });
  f.selections.push("Use current model and thinking");
  await f.configure("1");
  assert.equal(readConfig(f.path).slots[2].model, "model/with/slashes");
  await f.configure("10");
  assert.match(f.notifications.at(-1)[0], /Usage/);
});

test("overlapping keypresses do not race model changes", async t => {
  const f = fixture(t);
  updateConfig(f.path, c => { c.slots[1] = { provider: "openai-codex", model: "gpt-5.6-luna" }; });
  let release;
  let calls = 0;
  f.pi.setModel = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = f.press("alt+1");
  await f.press("alt+1");
  assert.equal(calls, 1);
  release(true);
  await first;
});
