function defaultRandom() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const value = new Uint32Array(1);
    cryptoApi.getRandomValues(value);
    return value[0] / 2 ** 32;
  }
  return Math.random();
}

function randomIndex(maxExclusive, random = defaultRandom) {
  return Math.floor(random() * maxExclusive);
}

function sameOrder(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function shuffleNames(names, random = defaultRandom) {
  const shuffled = [...names];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  if (shuffled.length > 1 && sameOrder(shuffled, names)) {
    const swapIndex = 1 + randomIndex(shuffled.length - 1, random);
    [shuffled[0], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[0]];
  }

  return shuffled;
}

export function mergeDrawQueue(queue, remaining, random = defaultRandom) {
  const remainingSet = new Set(remaining);
  const queued = [];
  const seen = new Set();

  for (const name of queue) {
    if (remainingSet.has(name) && !seen.has(name)) {
      queued.push(name);
      seen.add(name);
    }
  }

  const missing = shuffleNames(
    remaining.filter((name) => !seen.has(name)),
    random
  );

  for (const name of missing) {
    const insertIndex = randomIndex(queued.length + 1, random);
    queued.splice(insertIndex, 0, name);
  }

  return queued;
}
