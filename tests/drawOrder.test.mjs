import assert from "node:assert/strict";
import { mergeDrawQueue, shuffleNames } from "../lib/drawOrder.mjs";

assert.notDeepEqual(
  shuffleNames(["Alice", "Ben", "Carmen", "Dev"], () => 0.99),
  ["Alice", "Ben", "Carmen", "Dev"]
);

assert.deepEqual(
  mergeDrawQueue(["Alice"], ["Alice", "Ben", "Carmen"], () => 0),
  ["Ben", "Carmen", "Alice"]
);

assert.deepEqual(
  mergeDrawQueue(["Alice", "Ben", "Alice", "Old Name"], ["Alice", "Ben", "Carmen"], () => 0),
  ["Carmen", "Alice", "Ben"]
);

console.log("Draw order tests passed.");
