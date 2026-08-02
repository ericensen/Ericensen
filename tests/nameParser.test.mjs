import assert from "node:assert/strict";
import {
  dedupeNames,
  normalizeName,
  parseNamesFromSpeech,
  parseNamesFromText
} from "../lib/nameParser.mjs";

assert.equal(normalizeName("  \u201cAlice\u201d  "), "Alice");
assert.deepEqual(parseNamesFromText("Alice, Ben, Carmen"), ["Alice", "Ben", "Carmen"]);
assert.deepEqual(parseNamesFromText("the names are Alice comma Ben new line Carmen"), ["Alice", "Ben", "Carmen"]);
assert.deepEqual(parseNamesFromText("Alice and Ben and Carmen"), ["Alice", "Ben", "Carmen"]);
assert.deepEqual(parseNamesFromText("Mary Jane Watson"), ["Mary Jane Watson"]);
assert.deepEqual(parseNamesFromSpeech("Alice Ben Carmen"), ["Alice", "Ben", "Carmen"]);
assert.deepEqual(parseNamesFromSpeech("the names are Alice Ben and Carmen"), ["Alice", "Ben", "Carmen"]);
assert.deepEqual(parseNamesFromSpeech("Alice comma Ben next name Carmen"), ["Alice", "Ben", "Carmen"]);
assert.deepEqual(parseNamesFromSpeech("um Alice uh Ben"), ["Alice", "Ben"]);
assert.deepEqual(dedupeNames(["Alice", "alice", "Ben"]), ["Alice", "Ben"]);
assert.deepEqual(parseNamesFromText("Alice / Ben | Carmen; Dev"), ["Alice", "Ben", "Carmen", "Dev"]);

console.log("Name parser tests passed.");
