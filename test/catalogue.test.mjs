import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshCatalogue, scopedSnapshot } from "../extensions/catalogue.ts";

function fixture(refreshResult = {}) {
  const cached = [{ provider: "p", id: "model", name: "Old" }];
  const updated = [{ ...cached[0], name: "New" }];
  const refresh = new AbortController();
  const lifecycle = new AbortController();
  let available = cached;
  const registry = {
    getAvailable: () => available,
    find: (provider, id) => updated.find((m) => m.provider === provider && m.id === id),
    refresh: async (options) => {
      assert.deepEqual(options, { allowNetwork: true, force: true, signal: refresh.signal });
      available = updated;
      return typeof refreshResult === "function" ? refreshResult() : refreshResult;
    },
  };
  const missing = { provider: "p", id: "missing" };
  const scoped = [{ model: cached[0], thinkingLevel: "high" }, { model: missing }];
  return {
    cached,
    updated,
    refresh,
    lifecycle,
    scoped,
    run: () => refreshCatalogue(registry, scoped, refresh.signal, lifecycle.signal),
  };
}

test("refresh reconciles scoped metadata without changing scope or its thinking presets", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.models, f.updated);
  assert.deepEqual(result.scopedModels, [
    { model: f.updated[0], thinkingLevel: "high" },
    f.scoped[1],
  ]);
  assert.equal(f.scoped[0].model, f.cached[0]);
  assert.equal(result.scopedModels[1].model, f.scoped[1].model);
  assert.equal(result.status, "Model catalogue refreshed successfully");
});

for (const count of [1, 2]) {
  test(`refresh classifies ${count} provider errors`, async () => {
    const f = fixture({ errors: new Map(Array.from({ length: count }, (_, i) => [i, "error"])) });
    const result = await f.run();
    assert.equal(result.models, f.updated);
    assert.equal(
      result.status,
      `Refresh partially completed (${count} provider error${count === 1 ? "" : "s"}); cached models remain available`,
    );
  });
}

for (const signal of ["refresh", "lifecycle"]) {
  for (const throws of [false, true]) {
    test(`${signal} cancellation preserves cached models on ${throws ? "rejection" : "resolution"}`, async () => {
      const f = fixture(() => {
        f[signal].abort();
        if (throws) throw new Error("timeout");
        return {};
      });
      assert.deepEqual(await f.run(), { models: f.cached, status: "Refresh cancelled" });
    });
  }
}

test("registry-reported abort retains reconciled results", async () => {
  const f = fixture({ aborted: true });
  const result = await f.run();
  assert.equal(result.status, "Refresh cancelled");
  assert.equal(result.models, f.updated);
  assert.equal(result.scopedModels[0].model, f.updated[0]);
});

for (const error of [
  new DOMException("deadline", "TimeoutError"),
  new Error("request timed out"),
  new Error("timeout"),
]) {
  test(`timeout classification: ${error}`, async () => {
    const f = fixture(() => {
      throw error;
    });
    assert.deepEqual(await f.run(), {
      models: f.cached,
      status: "Refresh timed out; cached models remain available",
    });
  });
}

for (const error of [new Error("offline"), "offline"]) {
  test(`refresh failure preserves cache (${typeof error})`, async () => {
    const f = fixture(() => {
      throw error;
    });
    assert.deepEqual(await f.run(), { models: f.cached, status: "Refresh failed: offline" });
  });
}

test("scope snapshots copy the list and tolerate absent scope", () => {
  assert.deepEqual(scopedSnapshot({}), []);
  const scopedModels = fixture().scoped;
  const snapshot = scopedSnapshot({ scopedModels });
  assert.deepEqual(snapshot, scopedModels);
  assert.notEqual(snapshot, scopedModels);
});
