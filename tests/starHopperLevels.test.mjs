import assert from "node:assert/strict";
import { starHopperLevels } from "../lib/starHopperLevels.mjs";

const maxJumpColumns = 5;
const maxRiseRows = 3;
const maxDropRows = 5;

function tileAt(level, row, column) {
  return level.rows[row]?.[column] ?? ".";
}

function isSolid(tile) {
  return tile === "#" || tile === "=";
}

function isHazard(tile) {
  return tile === "^";
}

function isPassable(level, row, column) {
  const tile = tileAt(level, row, column);
  return !isSolid(tile) && !isHazard(tile);
}

function isStandable(level, row, column) {
  return isPassable(level, row, column) && isSolid(tileAt(level, row + 1, column));
}

function findMarker(level, marker) {
  for (let row = 0; row < level.rows.length; row += 1) {
    const column = level.rows[row].indexOf(marker);
    if (column >= 0) {
      return { row, column };
    }
  }
  return null;
}

function countMarker(text, marker) {
  return [...text].filter((tile) => tile === marker).length;
}

function standableKey(node) {
  return `${node.row}:${node.column}`;
}

function standableNodes(level) {
  const nodes = [];
  for (let row = 0; row < level.rows.length - 1; row += 1) {
    for (let column = 0; column < level.width; column += 1) {
      if (isStandable(level, row, column)) {
        nodes.push({ row, column });
      }
    }
  }
  return nodes;
}

function findStandableForMarker(level, marker) {
  const markerPoint = findMarker(level, marker);
  assert.ok(markerPoint, `${level.id} has ${marker}`);

  for (let radius = 0; radius <= 2; radius += 1) {
    for (let row = markerPoint.row; row <= markerPoint.row + radius; row += 1) {
      for (let column = markerPoint.column - radius; column <= markerPoint.column + radius; column += 1) {
        if (isStandable(level, row, column)) {
          return { row, column };
        }
      }
    }
  }

  assert.fail(`${level.id} ${marker} is not placed near a safe landing spot`);
}

function hasPathHeadroom(level, from, to) {
  const minColumn = Math.min(from.column, to.column);
  const maxColumn = Math.max(from.column, to.column);
  const highRow = Math.min(from.row, to.row);

  for (let column = minColumn; column <= maxColumn; column += 1) {
    if (!isPassable(level, highRow, column) || !isPassable(level, highRow - 1, column)) {
      return false;
    }
  }

  return true;
}

function canMoveBetween(level, from, to) {
  const horizontal = Math.abs(to.column - from.column);
  const rise = from.row - to.row;
  const drop = to.row - from.row;

  if (horizontal === 0 && rise === 0) {
    return false;
  }

  if (to.row === from.row && horizontal === 1) {
    return hasPathHeadroom(level, from, to);
  }

  return horizontal <= maxJumpColumns
    && rise <= maxRiseRows
    && drop <= maxDropRows
    && hasPathHeadroom(level, from, to);
}

function reachableFrom(level, start) {
  const nodes = standableNodes(level);
  const visited = new Set([standableKey(start)]);
  const queue = [start];

  while (queue.length) {
    const current = queue.shift();
    for (const next of nodes) {
      const key = standableKey(next);
      if (visited.has(key) || !canMoveBetween(level, current, next)) {
        continue;
      }
      visited.add(key);
      queue.push(next);
    }
  }

  return visited;
}

assert.ok(starHopperLevels.length > 0, "at least one Star Hopper level exists");

for (const level of starHopperLevels) {
  assert.ok(level.id, "level has an id");
  assert.ok(level.title, "level has a title");
  assert.ok(level.width > 0, "level has a positive width");
  assert.ok(level.tileSize > 0, "level has a positive tile size");
  assert.ok(level.rows.length > 0, "level has rows");

  const joined = level.rows.join("");
  assert.equal(level.rows.every((row) => row.length === level.width), true, `${level.id} rows match width`);
  assert.equal(countMarker(joined, "P"), 1, `${level.id} has one player start`);
  assert.equal(countMarker(joined, "X"), 1, `${level.id} has one exit`);
  assert.equal(countMarker(joined, "K"), 1, `${level.id} has one key`);
  assert.ok(joined.includes("*"), `${level.id} has crystals`);
  assert.ok(joined.includes("#"), `${level.id} has ground`);

  const start = findStandableForMarker(level, "P");
  const key = findStandableForMarker(level, "K");
  const exit = findStandableForMarker(level, "X");
  const fromStart = reachableFrom(level, start);
  const fromKey = reachableFrom(level, key);

  assert.ok(fromStart.has(standableKey(key)), `${level.id} key is reachable from the start`);
  assert.ok(fromKey.has(standableKey(exit)), `${level.id} exit is reachable after collecting the key`);
}

console.log("Star Hopper level tests passed.");
