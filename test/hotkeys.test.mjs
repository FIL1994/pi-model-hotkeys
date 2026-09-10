import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, updateConfig } from "../extensions/config.ts";
import {
  compactModelName,
  parseCommandArgs,
  registerModelHotkeys,
} from "../extensions/model-hotkeys.ts";
import { flatModelChoices } from "../extensions/model-picker.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "pi-hotkeys-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "config.json");
  const shortcuts = new Map();
  const commands = new Map();
  const notifications = [];
  const confirmations = [];
  const confirmationPrompts = [];
  const selections = [];
  const changes = [];
  const watcherCallbacks = [];
  const events = new Map();
  let widget;
  const tui = { mode: "fullscreen" };
  const model = { provider: "openai-codex", id: "gpt-5.6-luna", name: "GPT-5.6 Luna" };
  const models = [model];
  let thinking = "medium";
  const pi = {
    on: (name, handler) => events.set(name, handler),
    registerShortcut: (key, value) => shortcuts.set(key, value),
    registerCommand: (key, value) => commands.set(key, value),
    setModel: async (value) => {
      changes.push(value);
      return true;
    },
    getThinkingLevel: () => thinking,
    setThinkingLevel: (value) => {
      thinking = value;
    },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    isIdle: () => true,
    model,
    scopedModels: [],
    modelRegistry: {
      find: (provider, id) =>
        models.find((candidate) => candidate.provider === provider && candidate.id === id),
      getAvailable: () => models,
    },
    ui: {
      setWidget: (name, factory, options) => {
        assert.equal(name, "model-hotkeys");
        if (factory) assert.equal(options.placement, "belowEditor");
        widget =
          typeof factory === "function" ? factory(tui, { fg: (_color, text) => text }) : factory;
      },
      notify: (...args) => notifications.push(args),
      confirm: async (...args) => {
        confirmationPrompts.push(args);
        return confirmations.length ? confirmations.shift() : true;
      },
      select: async (_title, options) => {
        const selection = selections.shift();
        return typeof selection === "number" ? options[selection] : selection;
      },
      input: async () => selections.shift(),
    },
  };
  const register = () =>
    registerModelHotkeys(pi, path, (_path, _options, listener) => {
      watcherCallbacks.push(listener);
      return () => {
        const index = watcherCallbacks.indexOf(listener);
        if (index >= 0) watcherCallbacks.splice(index, 1);
      };
    });
  register();
  t.after(() => events.get("session_shutdown")?.({}, ctx));
  return {
    path,
    tui,
    wheel: async (overrides = {}) => {
      const result = widget?.handleMouse?.({
        type: "wheel",
        alt: true,
        ctrl: false,
        shift: false,
        wheelDelta: 1,
        ...overrides,
      });
      await new Promise((resolve) => setImmediate(resolve));
      return result;
    },
    pi,
    ctx,
    models,
    shortcuts,
    commands,
    notifications,
    confirmations,
    confirmationPrompts,
    selections,
    changes,
    register,
    triggerWatch: () => watcherCallbacks.forEach((listener) => listener()),
    emit: (name) => events.get(name)?.({}, ctx),
    legend: (width = 1000) => (Array.isArray(widget) ? widget : widget?.render(width)),
    configure: (args) => commands.get("model-hotkeys").handler(args, ctx),
    press: (key) => shortcuts.get(key).handler(ctx),
  };
}

test("Alt+wheel config defaults off, validates booleans, and toggles in the menu", async (t) => {
  const f = fixture(t);
  assert.equal(readConfig(f.path).altScroll ?? false, false);
  for (const value of [null, 1, "true", {}]) {
    assert.throws(
      () =>
        updateConfig(f.path, (c) => {
          c.altScroll = value;
        }),
      /Invalid/,
    );
  }
  f.selections.push("Alt+wheel: off (fullscreen model strip)", "Done");
  await f.configure("");
  assert.equal(readConfig(f.path).altScroll, true);
  f.selections.push("Alt+wheel: on (fullscreen model strip)", "Done");
  await f.configure("");
  assert.equal(readConfig(f.path).altScroll, false);
});

test("Alt+wheel cycles sparse thinking slots in both directions and wraps", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.altScroll = true;
    c.slots[2] = { provider: f.ctx.model.provider, model: f.ctx.model.id, thinking: "low" };
    c.slots[7] = { provider: f.ctx.model.provider, model: f.ctx.model.id, thinking: "high" };
  });
  f.emit("session_start");
  assert.deepEqual(await f.wheel(), { handled: true });
  assert.equal(f.pi.getThinkingLevel(), "low");
  await f.wheel();
  assert.equal(f.pi.getThinkingLevel(), "high");
  await f.wheel();
  assert.equal(f.pi.getThinkingLevel(), "low");
  await f.wheel({ wheelDelta: -1 });
  assert.equal(f.pi.getThinkingLevel(), "high");
});

test("Alt+wheel leaves unrelated input alone and observes live config", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.slots[1] = { provider: f.ctx.model.provider, model: f.ctx.model.id };
  });
  f.emit("session_start");
  assert.equal(await f.wheel(), undefined);
  updateConfig(f.path, (c) => {
    c.altScroll = true;
  });
  for (const event of [
    { alt: false },
    { ctrl: true },
    { shift: true },
    { wheelDelta: 0 },
    { type: "click" },
  ]) {
    assert.equal(await f.wheel(event), undefined);
  }
  f.tui.mode = "regular";
  assert.equal(await f.wheel(), undefined);
  assert.equal(f.changes.length, 0);
  f.tui.mode = "fullscreen";
  await f.wheel();
  assert.equal(f.changes.length, 1);
  updateConfig(f.path, (c) => {
    c.altScroll = false;
  });
  assert.equal(await f.wheel(), undefined);
  assert.equal(f.changes.length, 1);
});

test("Alt+wheel handles empty slots, busy sessions, and invalid config safely", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.altScroll = true;
  });
  f.emit("session_start");
  assert.equal(await f.wheel(), undefined);
  updateConfig(f.path, (c) => {
    c.slots[1] = { provider: f.ctx.model.provider, model: f.ctx.model.id };
  });
  f.ctx.isIdle = () => false;
  assert.deepEqual(await f.wheel(), { handled: true });
  assert.equal(f.changes.length, 0);
  assert.match(f.notifications.at(-1)[0], /finish/);
  writeFileSync(f.path, "invalid");
  assert.equal(await f.wheel(), undefined);
});

test("Alt+wheel remembers the selected slot when multiple presets match", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.altScroll = true;
    for (const key of [1, 3, 9]) {
      c.slots[key] = { provider: f.ctx.model.provider, model: f.ctx.model.id };
    }
  });
  f.emit("session_start");
  await f.press("alt+3");
  await f.wheel();
  assert.match(f.notifications.at(-1)[0], /Slot 9:/);
  await f.wheel();
  assert.match(f.notifications.at(-1)[0], /Slot 1:/);
  await f.wheel({ wheelDelta: -1 });
  assert.match(f.notifications.at(-1)[0], /Slot 9:/);
});

test("compact model names retain useful family context", () => {
  assert.equal(compactModelName("gpt-5.6-luna"), "luna");
  assert.equal(compactModelName("claude-sonnet-4-5"), "sonnet");
  assert.equal(compactModelName("gemini-2.5-pro"), "gemini-pro");
  assert.equal(compactModelName("namespace/gpt-5.4"), "gpt-5.4");
  assert.equal(compactModelName("codestral-latest"), "codestral");
});

test("model name style is configurable and updates the legend immediately", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.slots[1] = { provider: f.ctx.model.provider, model: f.ctx.model.id };
  });
  f.emit("model_select");

  const chooseStyle = async (current, selected) => {
    f.selections.push(`Model names: ${current}`, selected, "Done");
    await f.configure("");
  };

  await chooseStyle("Short — model ID", "Full — provider/model ID");
  assert.match(f.legend().join(""), /openai-codex\/gpt-5\.6-luna/);
  await chooseStyle("Full — provider/model ID", "Friendly — catalogue name");
  assert.match(f.legend().join(""), /GPT-5\.6 Luna/);
  await chooseStyle("Friendly — catalogue name", "Compact — family name");
  assert.match(f.legend().join(""), /alt\+1 luna/);
  assert.equal(readConfig(f.path).modelNameStyle, "compact");
});

test("compact and friendly name collisions are qualified", (t) => {
  const f = fixture(t);
  f.models.push(
    { provider: "openai", id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { provider: "openai-codex", id: "gpt-5.7-luna", name: "GPT-5.7 Luna" },
  );
  updateConfig(f.path, (c) => {
    c.modelNameStyle = "compact";
    c.slots[1] = { provider: "openai-codex", model: "gpt-5.6-luna" };
    c.slots[2] = { provider: "openai", model: "gpt-5.6-luna" };
    c.slots[3] = { provider: "openai-codex", model: "gpt-5.7-luna" };
  });
  f.emit("model_select");
  let text = f.legend().join("");
  assert.match(text, /alt\+1 openai-codex\/gpt-5\.6-luna/);
  assert.match(text, /alt\+2 openai\/luna/);
  assert.match(text, /alt\+3 openai-codex\/gpt-5\.7-luna/);

  updateConfig(f.path, (c) => {
    c.modelNameStyle = "friendly";
  });
  f.emit("model_select");
  text = f.legend().join("");
  assert.match(text, /GPT-5\.6 Luna — openai-codex\/gpt-5\.6-luna/);
  assert.match(text, /GPT-5\.6 Luna — openai\/gpt-5\.6-luna/);
});

test("labels can be set, preserved on reassignment, and removed", async (t) => {
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

test("shutdown prevents pending switch from applying thinking or notifying", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.slots[1] = { ...f.ctx.model, model: f.ctx.model.id, thinking: "high" };
  });
  let resolve;
  f.pi.setModel = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = f.press("alt+1");
  f.emit("session_shutdown");
  resolve(true);
  await pending;
  assert.equal(f.pi.getThinkingLevel(), "medium");
  assert.deepEqual(f.notifications, []);
});

test("shutdown aborts pending configuration without saving", async (t) => {
  const f = fixture(t);
  let resolve, signal;
  f.ctx.ui.select = (_title, _options, options) => {
    signal = options.signal;
    return new Promise((r) => {
      resolve = r;
    });
  };
  const pending = f.configure("1");
  f.emit("session_shutdown");
  assert.equal(signal.aborted, true);
  resolve("Use current model and thinking");
  await pending;
  assert.deepEqual(readConfig(f.path).slots, {});
  assert.deepEqual(f.notifications, []);
});

test("invalid updates preserve the original config", (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.slots[1] = { provider: "p", model: "m" };
  });
  const original = readFileSync(f.path, "utf8");
  for (const invalid of [
    { provider: " p" },
    { model: "m " },
    { label: "bad\u001b" },
    { label: 42 },
  ]) {
    assert.throws(() => updateConfig(f.path, (c) => Object.assign(c.slots[1], invalid)));
    assert.equal(readFileSync(f.path, "utf8"), original);
  }
  assert.throws(() =>
    updateConfig(f.path, (c) => {
      c.modelNameStyle = "tiny";
    }),
  );
  assert.equal(readFileSync(f.path, "utf8"), original);
});

test("legacy configs default to short model names", (t) => {
  const f = fixture(t);
  writeFileSync(
    f.path,
    JSON.stringify({
      modifier: "alt",
      slots: { 1: { provider: "openai-codex", model: "gpt-5.6-luna" } },
    }),
  );
  assert.equal(readConfig(f.path).modelNameStyle, undefined);
  f.emit("model_select");
  assert.match(f.legend().join(""), /alt\+1 gpt-5\.6-luna/);
});

test("picker only offers supported thinking levels", async (t) => {
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

test("registers all nine keys; unassigned slots do not switch", async (t) => {
  const f = fixture(t);
  assert.deepEqual(
    [...f.shortcuts.keys()],
    Array.from({ length: 9 }, (_, i) => `alt+${i + 1}`),
  );
  await f.press("alt+1");
  assert.equal(f.changes.length, 0);
  assert.match(f.notifications[0][0], /unassigned/);
});

test("legend appears at startup and refreshes after saving, switching, and clearing", async (t) => {
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

test("legend wraps all nine slots and shows active, not pending, modifier", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    for (let i = 1; i <= 9; i++) c.slots[i] = { provider: "provider", model: `model-${i}` };
    c.modifier = "ctrl";
  });
  f.emit("model_select");
  const lines = f.legend(35);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => visibleWidth(line) <= 35));
  const text = lines.join(" ");
  for (let i = 1; i <= 9; i++) assert.match(text, new RegExp(`alt\\+${i}`));
  assert.match(text, /ctrl pending \/reload/);
});

test("legend picks up external config edits and cleans up its watcher", async (t) => {
  const f = fixture(t);
  f.emit("session_start");
  updateConfig(f.path, (c) => {
    c.slots[4] = { provider: "external", model: "new-model" };
  });
  f.triggerWatch();
  assert.match(f.legend().join(""), /alt\+4 new-model/);
  f.emit("session_shutdown");
  assert.equal(f.legend(), undefined);
});

test("legend does not create TUI widgets in non-TUI modes", (t) => {
  const f = fixture(t);
  f.ctx.mode = "rpc";
  f.emit("session_start");
  assert.equal(f.legend(), undefined);
});

test("legend highlights exact thinking presets and keep-current slots", (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
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

test("compact labels qualify provider collisions without shortening model IDs", (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
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

test("configure current model, persist, switch, and clear", async (t) => {
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

test("model picker supports explicit thinking and cancellation", async (t) => {
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

test("keep current thinking does not reset it", async (t) => {
  const f = fixture(t);
  f.selections.push("Choose model", "openai-codex", "gpt-5.6-luna", "Keep current");
  await f.configure("1");
  f.pi.setThinkingLevel("low");
  await f.press("alt+1");
  assert.equal(f.pi.getThinkingLevel(), "low");
});

test("busy, missing-model, and auth failures leave thinking unchanged", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.slots[1] = { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "high" };
  });
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

test("modifier is saved and registered on reload", async (t) => {
  const f = fixture(t);
  f.selections.push(9, "ctrl+alt", "Done");
  await f.configure("");
  assert.equal(readConfig(f.path).modifier, "ctrl+alt");
  assert.ok(f.shortcuts.has("alt+1"));
  f.shortcuts.clear();
  f.register();
  assert.ok(f.shortcuts.has("ctrl+alt+1"));
});

test("invalid config is preserved and errors are reported", async (t) => {
  const f = fixture(t);
  for (const text of [
    "{broken",
    '{"modifier":"alt","slots":{"0":{}}}',
    '{"modifier":"invalid","slots":{}}',
  ]) {
    writeFileSync(f.path, text);
    assert.throws(() =>
      updateConfig(f.path, (c) => {
        c.slots = {};
      }),
    );
    await f.configure("1");
    await f.press("alt+1");
    assert.equal(readFileSync(f.path, "utf8"), text);
    assert.equal(f.notifications.at(-1)[1], "error");
  }
});

test("fresh edits preserve other slots and invalid arguments are rejected", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.slots[2] = { provider: "other", model: "model/with/slashes" };
  });
  f.selections.push("Use current model and thinking");
  await f.configure("1");
  assert.equal(readConfig(f.path).slots[2].model, "model/with/slashes");
  await f.configure("10");
  assert.match(f.notifications.at(-1)[0], /Usage/);
});

test("overlapping keypresses do not race model changes", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.slots[1] = { provider: "openai-codex", model: "gpt-5.6-luna" };
  });
  let release;
  let calls = 0;
  f.pi.setModel = () => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = f.press("alt+1");
  await f.press("alt+1");
  assert.equal(calls, 1);
  release(true);
  await first;
});

test("shortcut refuses an assigned model outside a non-empty scoped model list", async (t) => {
  const f = fixture(t);
  f.ctx.scopedModels = [{ model: { provider: "other", id: "allowed", name: "Allowed" } }];
  updateConfig(f.path, (c) => {
    c.slots[1] = { provider: f.ctx.model.provider, model: f.ctx.model.id };
  });
  await f.press("alt+1");
  assert.equal(f.changes.length, 0);
  assert.match(f.notifications.at(-1)[0], /outside the current model scope/);
});

test("command parses a slot and optional prefilled search", () => {
  assert.deepEqual(parseCommandArgs(""), {});
  assert.deepEqual(parseCommandArgs("3"), { slot: "3", query: undefined });
  assert.deepEqual(parseCommandArgs(" 3   gpt luna "), { slot: "3", query: "gpt luna" });
  assert.equal(parseCommandArgs("gpt luna"), undefined);
  assert.equal(parseCommandArgs("10 luna"), undefined);
});

test("RPC fallback is flat, scoped by default, and displays name/provider/id", async (t) => {
  const f = fixture(t);
  const second = { provider: "other", id: "other-model", name: "Other Friendly" };
  f.models.push(second);
  f.ctx.scopedModels = [{ model: f.ctx.model, thinkingLevel: "low" }];
  f.ctx.mode = "rpc";
  const choice = flatModelChoices([f.ctx.model], {
    current: f.ctx.model,
    scopedThinking: new Map([[`${f.ctx.model.provider}\u0000${f.ctx.model.id}`, "low"]]),
  })[0];
  f.selections.push("Choose model", choice, "Keep current (effective: medium)");
  await f.configure("1");
  assert.deepEqual(readConfig(f.path).slots[1], {
    provider: f.ctx.model.provider,
    model: f.ctx.model.id,
  });
});

test("RPC fallback resolves displayed choices after concurrent slot changes", async (t) => {
  const f = fixture(t);
  f.ctx.mode = "rpc";
  const target = { provider: "other", id: "target", name: "Z target" };
  const other = { provider: "other", id: "other", name: "A other" };
  // Registry order differs from display order (current model, assigned model, then name).
  f.models.unshift(other, target);
  updateConfig(f.path, (config) => {
    config.slots[2] = { provider: target.provider, model: target.id };
  });
  const select = f.ctx.ui.select;
  f.ctx.ui.select = async (title, choices) => {
    if (title !== "Choose model") return select(title, choices);
    const displayed = flatModelChoices(f.models, {
      current: f.ctx.model,
      slots: readConfig(f.path).slots,
    });
    assert.deepEqual(choices, displayed);
    const choice = choices[1];
    updateConfig(f.path, (config) => {
      config.slots[2] = { provider: other.provider, model: other.id };
    });
    return choice;
  };
  f.selections.push("Choose model", "Keep current (effective: medium)");
  await f.configure("1");
  assert.deepEqual(readConfig(f.path).slots[1], { provider: target.provider, model: target.id });
  assert.deepEqual(readConfig(f.path).slots[2], { provider: other.provider, model: other.id });
});

test("RPC fallback applies the command's prefilled search and previews the active modifier", async (t) => {
  const f = fixture(t);
  f.ctx.mode = "rpc";
  updateConfig(f.path, (config) => {
    config.modifier = "ctrl";
  });
  const choice = flatModelChoices([f.ctx.model], { current: f.ctx.model })[0];
  f.selections.push("Choose model", choice, "Keep current (effective: medium)");
  await f.configure("1 gpt luna");
  assert.equal(readConfig(f.path).slots[1].model, f.ctx.model.id);
  assert.match(f.confirmationPrompts.at(-1)[1], /alt\+1/);
  assert.doesNotMatch(f.confirmationPrompts.at(-1)[1], /ctrl\+1/);

  f.notifications.length = 0;
  f.selections.push("Choose model");
  await f.configure("2 definitely-missing");
  assert.equal(readConfig(f.path).slots[2], undefined);
  assert.match(f.notifications.at(-1)[0], /No models match/);
});

test("copy preserves the target label and duplicate confirmation can reject or accept", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (c) => {
    c.slots[1] = {
      provider: f.ctx.model.provider,
      model: f.ctx.model.id,
      thinking: "medium",
      label: "Source",
    };
    c.slots[2] = { provider: "other", model: "old", label: "Target" };
  });
  f.confirmations.push(true);
  f.selections.push(
    "Copy preset from another slot",
    "1: Source — openai-codex/gpt-5.6-luna (medium)",
  );
  await f.configure("2");
  assert.deepEqual(readConfig(f.path).slots[2], {
    provider: f.ctx.model.provider,
    model: f.ctx.model.id,
    thinking: "medium",
    label: "Target",
  });
  assert.doesNotMatch(f.confirmationPrompts.at(-1)[1], /Source/);
  assert.match(f.confirmationPrompts.at(-1)[1], /Target/);

  f.confirmations.push(false);
  f.selections.push("Use current model and thinking");
  await f.configure("3");
  assert.equal(readConfig(f.path).slots[3], undefined);
});

test("save preview can reject or accept a non-duplicate preset", async (t) => {
  const f = fixture(t);
  f.confirmations.push(false);
  f.selections.push("Use current model and thinking");
  await f.configure("1");
  assert.equal(readConfig(f.path).slots[1], undefined);
  assert.equal(f.confirmationPrompts.at(-1)[0], "Save slot 1");

  f.confirmations.push(true);
  f.selections.push("Use current model and thinking");
  await f.configure("1");
  assert.equal(readConfig(f.path).slots[1].model, f.ctx.model.id);
});

test("save preview uses the legend's collision-qualified model label", async (t) => {
  const f = fixture(t);
  updateConfig(f.path, (config) => {
    config.slots[1] = { provider: "other", model: f.ctx.model.id };
  });
  f.confirmations.push(true);
  f.selections.push("Use current model and thinking");
  await f.configure("2");
  assert.match(
    f.confirmationPrompts.at(-1)[1],
    new RegExp(`openai-codex/${f.ctx.model.id.replaceAll(".", "\\.")}`),
  );
});
