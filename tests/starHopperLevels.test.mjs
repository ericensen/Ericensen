import assert from "node:assert/strict";
import { starHopperLevels } from "../lib/starHopperLevels.mjs";

assert.ok(starHopperLevels.length > 0, "at least one Star Hopper level exists");

for (const level of starHopperLevels) {
  assert.ok(level.id, "level has an id");
  assert.ok(level.title, "level has a title");
  assert.ok(level.width > 0, "level has a positive width");
  assert.ok(level.tileSize > 0, "level has a positive tile size");
  assert.ok(level.rows.length > 0, "level has rows");

  const joined = level.rows.join("");
  assert.equal(level.rows.every((row) => row.length === level.width), true, `${level.id} rows match width`);
  assert.ok(joined.includes("P"), `${level.id} has a player start`);
  assert.ok(joined.includes("X"), `${level.id} has an exit`);
  assert.ok(joined.includes("K"), `${level.id} has a key`);
  assert.ok(joined.includes("*"), `${level.id} has crystals`);
  assert.ok(joined.includes("#"), `${level.id} has ground`);
}

console.log("Star Hopper level tests passed.");
