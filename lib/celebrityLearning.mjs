const DAY_MS = 86_400_000;

export const REVIEW_GRADES = Object.freeze({
  again: 0,
  hard: 1,
  good: 2,
  easy: 3
});

export function emptyCelebrityProgress() {
  return {
    reviews: 0,
    correct: 0,
    streak: 0,
    lapses: 0,
    intervalDays: 0,
    ease: 2.3,
    dueAt: 0,
    lastReviewedAt: 0
  };
}
export function masteryScore(progress = emptyCelebrityProgress()) {
  if (!progress.reviews) {
    return 0;
  }

  const accuracy = progress.correct / progress.reviews;
  const intervalStrength = Math.min(1, Math.log2((progress.intervalDays || 0) + 1) / 7);
  const streakStrength = Math.min(1, (progress.streak || 0) / 6);
  const lapsePenalty = Math.min(0.3, (progress.lapses || 0) * 0.035);
  return Math.max(0, Math.min(100, Math.round(
    (accuracy * 0.46 + intervalStrength * 0.34 + streakStrength * 0.2 - lapsePenalty) * 100
  )));
}

export function applyCelebrityReview(previous, gradeName, now = Date.now()) {
  const grade = REVIEW_GRADES[gradeName];
  if (grade === undefined) {
    throw new Error(`Unknown review grade: ${gradeName}`);
  }

  const next = { ...emptyCelebrityProgress(), ...previous };
  next.reviews += 1;
  next.lastReviewedAt = now;

  if (grade === REVIEW_GRADES.again) {
    next.streak = 0;
    next.lapses += 1;
    next.intervalDays = 0;
    next.ease = Math.max(1.35, next.ease - 0.2);
    next.dueAt = now + 10 * 60 * 1000;
    return next;
  }

  next.correct += 1;
  next.streak += 1;
  if (grade === REVIEW_GRADES.hard) {
    next.ease = Math.max(1.35, next.ease - 0.08);
    next.intervalDays = Math.max(1, Math.round((next.intervalDays || 1) * 1.25));
  } else if (grade === REVIEW_GRADES.good) {
    next.intervalDays = next.intervalDays
      ? Math.max(2, Math.round(next.intervalDays * next.ease))
      : 1;
  } else {
    next.ease = Math.min(3.1, next.ease + 0.12);
    next.intervalDays = next.intervalDays
      ? Math.max(4, Math.round(next.intervalDays * next.ease * 1.35))
      : 4;
  }
  next.dueAt = now + next.intervalDays * DAY_MS;
  return next;
}

function shuffled(values, random = Math.random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function createCelebrityChoices(celebrity, catalog, random = Math.random) {
  const sameGender = catalog.filter((candidate) => (
    candidate.id !== celebrity.id && candidate.gender === celebrity.gender
  ));
  const sameField = sameGender.filter((candidate) => candidate.field === celebrity.field);
  const distractors = [];

  for (const candidate of shuffled(sameField, random)) {
    if (distractors.length === 3) break;
    distractors.push(candidate);
  }
  for (const candidate of shuffled(sameGender, random)) {
    if (distractors.length === 3) break;
    if (!distractors.some((item) => item.id === candidate.id)) {
      distractors.push(candidate);
    }
  }

  return shuffled([celebrity, ...distractors], random);
}

export function chooseNextCelebrity(catalog, progressById, now = Date.now(), random = Math.random) {
  if (!catalog.length) {
    return null;
  }

  const weighted = catalog.map((celebrity) => {
    const progress = progressById[celebrity.id] || emptyCelebrityProgress();
    const unseenBoost = progress.reviews ? 0 : 55;
    const dueBoost = progress.dueAt <= now ? 35 : 0;
    const weakness = 100 - masteryScore(progress);
    const overdueDays = progress.dueAt && progress.dueAt < now
      ? Math.min(30, (now - progress.dueAt) / DAY_MS)
      : 0;
    return {
      celebrity,
      weight: 1 + unseenBoost + dueBoost + weakness * 0.5 + overdueDays
    };
  });

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let target = random() * totalWeight;
  for (const item of weighted) {
    target -= item.weight;
    if (target <= 0) {
      return item.celebrity;
    }
  }
  return weighted.at(-1).celebrity;
}
