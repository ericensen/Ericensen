const SPOKEN_SEPARATORS = [
  /\bnew\s+line\b/gi,
  /\bnext\s+line\b/gi,
  /\bnext\s+name\b/gi,
  /\bnew\s+name\b/gi,
  /\bnext\b/gi,
  /\bcomma\b/gi,
  /\bcoma\b/gi,
  /\bsemicolon\b/gi,
  /\bperiod\b/gi,
  /\bfull\s+stop\b/gi,
  /\band\s+then\b/gi,
  /\bthen\b/gi
];

const FILLER_PHRASES = [
  /\bthe\s+names?\s+are\b/gi,
  /\badd\s+names?\b/gi,
  /\binclude\b/gi,
  /\bplease\b/gi
];

const SPEECH_FILLER_WORDS = new Set(["uh", "um", "uhm", "hmm"]);

export function normalizeName(value) {
  return value
    .replace(/[()[\]{}"'\u201c\u201d\u2018\u2019]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:|\-/]+|[,.;:|\-/]+$/g, "");
}

export function dedupeNames(names) {
  const seen = new Set();
  const result = [];

  for (const name of names) {
    const cleaned = normalizeName(name);
    const key = cleaned.toLocaleLowerCase();
    if (cleaned && !seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }

  return result;
}

export function parseNamesFromText(input) {
  if (!input || !input.trim()) {
    return [];
  }

  let normalized = input;

  for (const phrase of FILLER_PHRASES) {
    normalized = normalized.replace(phrase, " ");
  }

  for (const separator of SPOKEN_SEPARATORS) {
    normalized = normalized.replace(separator, "\n");
  }

  normalized = normalized
    .replace(/\s+(?:and|&)\s+/gi, "\n")
    .replace(/[;|/]+/g, "\n")
    .replace(/,+/g, "\n")
    .replace(/\n+/g, "\n");

  return dedupeNames(normalized.split("\n"));
}

export function parseNamesFromSpeech(input) {
  if (!input || !input.trim()) {
    return [];
  }

  let normalized = input;

  for (const phrase of FILLER_PHRASES) {
    normalized = normalized.replace(phrase, " ");
  }

  for (const separator of SPOKEN_SEPARATORS) {
    normalized = normalized.replace(separator, "\n");
  }

  normalized = normalized
    .replace(/\s+(?:and|&)\s+/gi, "\n")
    .replace(/[;|/]+/g, "\n")
    .replace(/,+/g, "\n")
    .replace(/\n+/g, "\n");

  const names = normalized
    .split("\n")
    .flatMap((segment) => splitSpeechSegment(segment));

  return dedupeNames(names);
}

function splitSpeechSegment(segment) {
  const cleaned = normalizeName(segment);
  if (!cleaned) {
    return [];
  }

  const words = cleaned
    .split(/\s+/)
    .map((word) => normalizeName(word))
    .filter((word) => word && !SPEECH_FILLER_WORDS.has(word.toLocaleLowerCase()));

  return words.length > 1 ? words : [cleaned];
}
