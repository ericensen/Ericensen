import assert from "node:assert/strict";
import {
  applyCelebrityReview,
  createCelebrityChoices,
  masteryScore
} from "../lib/celebrityLearning.mjs";

const now = Date.UTC(2026, 0, 1);
const firstGood = applyCelebrityReview(undefined, "good", now);
const secondGood = applyCelebrityReview(firstGood, "good", now + 86_400_000);
const easy = applyCelebrityReview(secondGood, "easy", now + 2 * 86_400_000);

assert.equal(firstGood.streak, 1);
assert.equal(firstGood.intervalDays, 1);
assert.ok(secondGood.intervalDays > firstGood.intervalDays);
assert.ok(easy.intervalDays > secondGood.intervalDays);
assert.ok(masteryScore(easy) > masteryScore(firstGood));

const missed = applyCelebrityReview(easy, "again", now + 3 * 86_400_000);
assert.equal(missed.streak, 0);
assert.equal(missed.lapses, 1);
assert.ok(masteryScore(missed) < masteryScore(easy));

const catalog = [
  { id: "correct", gender: "female", field: "Film & TV" },
  { id: "same-field-1", gender: "female", field: "Film & TV" },
  { id: "same-field-2", gender: "female", field: "Film & TV" },
  { id: "same-gender", gender: "female", field: "Music" },
  { id: "different-gender", gender: "male", field: "Film & TV" }
];
const choices = createCelebrityChoices(catalog[0], catalog, () => 0.4);
assert.equal(choices.length, 4);
assert.ok(choices.some((item) => item.id === "correct"));
assert.ok(choices.every((item) => item.gender === "female"));

console.log("Celebrity learning tests passed.");
