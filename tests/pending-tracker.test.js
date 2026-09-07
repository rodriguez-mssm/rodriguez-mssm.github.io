import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("pending-processing tracker uses an exact approved RLS-protected count", async () => {
  const api = await readFile(new URL("../inventory/js/api.js", import.meta.url), "utf8");
  assert.match(api, /pendingCount:[\s\S]+select\("id", \{ count: "exact", head: true \}\)[\s\S]+eq\("result_status", "AWAITING_RESULTS"\)/);
});

test("home and pending screens refresh the pending tracker without leaking timers", async () => {
  const app = await readFile(new URL("../inventory/js/app.js", import.meta.url), "utf8");
  assert.match(app, /id="home-pending-count" class="pending-tracker"/);
  assert.match(app, /id="pending-screen-count" class="pending-tracker"/);
  assert.match(app, /setInterval\([^]*15000\)/);
  assert.match(app, /stopPendingTracker\(\)/);
  assert.match(app, /sample\$\{count === 1 \? "" : "s"\} pending processing/);
});
