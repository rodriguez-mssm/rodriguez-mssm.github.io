import test from "node:test";
import assert from "node:assert/strict";
import { canTransition } from "../inventory/js/lifecycle.js";

test("planned samples can activate or be marked not created", () => {
  assert.equal(canTransition("PLANNED", "ACTIVE"), true);
  assert.equal(canTransition("PLANNED", "NOT_CREATED"), true);
});

test("duplicate activation is not a valid transition", () => {
  assert.equal(canTransition("ACTIVE", "ACTIVE"), false);
});

test("terminal sample states remain historical", () => {
  assert.equal(canTransition("NOT_CREATED", "ACTIVE"), false);
  assert.equal(canTransition("CONSUMED", "ACTIVE"), false);
});
