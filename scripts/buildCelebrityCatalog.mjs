import { access, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const ROOT = new URL("../", import.meta.url);
const DATA_PATH = new URL("../data/celebrities.json", import.meta.url);
const IMAGE_DIR = new URL("../assets/celebrities/", import.meta.url);
const USER_AGENT = "EricensenFaceCards/1.1 (https://github.com/ericensen/Ericensen)";
const TARGET_COUNT = Number(process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] || 1000);
const DOWNLOAD_IMAGES = process.argv.includes("--download-images");
const SAMPLE_COUNT = Number(process.argv.find((arg) => arg.startsWith("--samples="))?.split("=")[1] || 156);
let collectedSampleCount = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getJson(url, attempt = 1, allowNotFound = false) {
  const response = await fetch(url, {
    headers: { "Api-User-Agent": USER_AGENT, "User-Agent": USER_AGENT }
  });
  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 5) throw new Error(`Request failed (${response.status}): ${url}`);
    await sleep(500 * (2 ** attempt));
    return getJson(url, attempt + 1, allowNotFound);
  }
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response.json();
}

function batch(values, size) {
  const groups = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function recentSampleDates(count) {
  const now = new Date();
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return Array.from({ length: count }, () => {
    const date = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() - 7);
    return date;
  });
}

async function getPopularTitles() {
  const totals = new Map();
  for (const date of recentSampleDates(SAMPLE_COUNT * 2)) {
    if (collectedSampleCount >= SAMPLE_COUNT) break;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/US/all-access/${year}/${month}/${day}`;
    const data = await getJson(url, 1, true);
    if (!data) {
      process.stdout.write(`Skipped unavailable U.S. rankings for ${year}-${month}-${day}\n`);
      continue;
    }
    collectedSampleCount += 1;
    for (const article of data.items?.[0]?.articles || []) {
      if (article.project !== "en.wikipedia") continue;
      const title = article.article.replaceAll("_", " ");
      if (title.includes(":") || title === "Main Page" || title === "-" || title.startsWith("List of ")) continue;
      const current = totals.get(title) || { title, views: 0, appearances: 0, rankScore: 0 };
      current.views += Number(article.views_ceil || 0);
      current.appearances += 1;
      current.rankScore += Math.max(0, 1001 - Number(article.rank || 1001));
      totals.set(title, current);
    }
    process.stdout.write(`Collected U.S. rankings for ${year}-${month}-${day}\n`);
  }
  return [...totals.values()]
    .map((item) => ({
      ...item,
      // Repeated U.S. interest is a better fame signal than one exceptional news day.
      usScore: item.appearances * 1_000_000 + item.rankScore * 100 + Math.log1p(item.views) * 1_000
    }))
    .sort((a, b) => b.usScore - a.usScore)
    .slice(0, Math.max(6000, TARGET_COUNT * 6));
}

async function getWikipediaPages(popularTitles) {
  const byTitle = new Map(popularTitles.map((item) => [item.title, item]));
  const pages = [];
  for (const titles of batch(popularTitles.map((item) => item.title), 40)) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      redirects: "1",
      prop: "pageprops|extracts",
      ppprop: "wikibase_item",
      exintro: "1",
      explaintext: "1",
      exsentences: "1",
      titles: titles.join("|")
    });
    const data = await getJson(`https://en.wikipedia.org/w/api.php?${params}`);
    for (const page of data.query?.pages || []) {
      const ranked = byTitle.get(page.title) || popularTitles.find((item) => item.title === page.title);
      if (page.pageprops?.wikibase_item) {
        pages.push({
          id: page.pageprops.wikibase_item,
          wikipediaTitle: page.title,
          usViews: ranked?.views || 0,
          usAppearances: ranked?.appearances || 0,
          usScore: ranked?.usScore || 0,
          extract: page.extract || ""
        });
      }
    }
    await sleep(45);
  }
  return [...new Map(pages.map((page) => [page.id, page])).values()];
}

const GENDERS = new Map([
  ["Q6581097", "male"],
  ["Q6581072", "female"]
]);
const US_FAMOUS_SOCCER_PLAYERS = new Set(["Q11571", "Q615", "Q10520", "Q834"]);

const FIELD_BY_OCCUPATION = new Map([
  ["Q33999", "Film & TV"], ["Q10800557", "Film & TV"], ["Q2526255", "Film & TV"],
  ["Q177220", "Music"], ["Q639669", "Music"], ["Q36834", "Music"], ["Q488205", "Music"],
  ["Q2066131", "Sports"], ["Q937857", "Sports"], ["Q10833314", "Sports"], ["Q19204627", "Sports"],
  ["Q82955", "Politics"], ["Q11696", "Politics"], ["Q30461", "Politics"],
  ["Q36180", "Writing"], ["Q49757", "Writing"], ["Q6625963", "Writing"],
  ["Q901", "Science"], ["Q169470", "Science"], ["Q81096", "Science"],
  ["Q483501", "Business"], ["Q131524", "Business"],
  ["Q1622272", "Media"], ["Q245068", "Media"], ["Q947873", "Media"], ["Q13590141", "Media"]
]);

function claimId(entity, property) {
  return entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value?.id || "";
}

function claimIds(entity, property) {
  return (entity.claims?.[property] || [])
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function claimTime(entity, property) {
  return entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value?.time || "";
}

function imageName(entity) {
  return entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value || "";
}

function determineField(entity) {
  for (const claim of entity.claims?.P106 || []) {
    const id = claim.mainsnak?.datavalue?.value?.id;
    if (FIELD_BY_OCCUPATION.has(id)) return FIELD_BY_OCCUPATION.get(id);
  }
  return "Public Life";
}

function diedBefore1900(entity) {
  const death = claimTime(entity, "P570");
  if (death) return Number(death.slice(1, 5)) < 1900;
  const birth = claimTime(entity, "P569");
  return Boolean(birth && Number(birth.slice(1, 5)) < 1840);
}

async function getPeople(pages) {
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const people = [];
  for (const ids of batch(pages.map((page) => page.id), 50)) {
    const params = new URLSearchParams({
      action: "wbgetentities",
      format: "json",
      props: "labels|descriptions|claims|sitelinks",
      languages: "en",
      sitefilter: "enwiki",
      ids: ids.join("|")
    });
    const data = await getJson(`https://www.wikidata.org/w/api.php?${params}`);
    for (const entity of Object.values(data.entities || {})) {
      const page = pageById.get(entity.id);
      if (!page || claimId(entity, "P31") !== "Q5" || !imageName(entity) || diedBefore1900(entity)) continue;
      const occupations = claimIds(entity, "P106");
      const countries = claimIds(entity, "P27");
      const isInternationalSoccerPlayer = occupations.includes("Q937857") && !countries.includes("Q30");
      if (isInternationalSoccerPlayer && !US_FAMOUS_SOCCER_PLAYERS.has(entity.id)) continue;
      const genderId = claimId(entity, "P21");
      people.push({
        id: entity.id,
        name: entity.labels?.en?.value || page.wikipediaTitle,
        gender: GENDERS.get(genderId) || "another",
        field: determineField(entity),
        knownFor: page.extract || entity.descriptions?.en?.value || "Public figure",
        wikipediaTitle: page.wikipediaTitle,
        wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.wikipediaTitle.replaceAll(" ", "_"))}`,
        imageFile: imageName(entity),
        usViews: page.usViews,
        usAppearances: page.usAppearances,
        usScore: page.usScore
      });
    }
    await sleep(45);
  }
  return people.sort((a, b) => b.usScore - a.usScore);
}

function plainText(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function addImageMetadata(people) {
  const completed = [];
  const byFile = new Map(people.map((person) => [`File:${person.imageFile}`, person]));
  for (const titles of batch([...byFile.keys()], 20)) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      redirects: "1",
      prop: "imageinfo",
      iiprop: "url|mime|extmetadata",
      iiurlwidth: "420",
      iiextmetadatafilter: "Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms|AttributionRequired",
      titles: titles.join("|")
    });
    const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
    for (const page of data.query?.pages || []) {
      const person = byFile.get(page.title);
      const info = page.imageinfo?.[0];
      if (!person || !info?.thumburl) continue;
      const metadata = info.extmetadata || {};
      completed.push({
        ...person,
        imageUrl: info.thumburl,
        imageMime: info.thumbmime || info.mime || "image/jpeg",
        imageSourceUrl: info.descriptionurl,
        imageAuthor: plainText(metadata.Artist?.value || metadata.Credit?.value || "Wikimedia Commons contributor"),
        imageLicense: plainText(metadata.LicenseShortName?.value || metadata.UsageTerms?.value || "See source"),
        imageLicenseUrl: metadata.LicenseUrl?.value || info.descriptionurl
      });
    }
    await sleep(80);
  }
  return completed;
}

function extensionFor(person) {
  const mimeExtension = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
  return mimeExtension.get(person.imageMime) || extname(new URL(person.imageUrl).pathname) || ".jpg";
}

async function downloadImage(person, attempt = 1) {
  const extension = extensionFor(person);
  const fileName = `${person.id}${extension}`;
  try {
    await access(new URL(fileName, IMAGE_DIR));
    return { ...person, image: `assets/celebrities/${fileName}` };
  } catch {
    // The portrait is not cached locally yet.
  }
  const response = await fetch(person.imageUrl, { headers: { "User-Agent": USER_AGENT } });
  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 5) throw new Error(`Image download failed (${response.status}): ${person.imageUrl}`);
    await sleep(1000 * (2 ** attempt));
    return downloadImage(person, attempt + 1);
  }
  if (!response.ok) throw new Error(`Image download failed (${response.status}): ${person.imageUrl}`);
  await writeFile(new URL(fileName, IMAGE_DIR), Buffer.from(await response.arrayBuffer()));
  return { ...person, image: `assets/celebrities/${fileName}` };
}

async function mapLimited(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function pruneUnusedImages(catalog) {
  const retained = new Set(catalog.map((person) => person.image.split("/").at(-1)));
  const entries = await readdir(IMAGE_DIR, { withFileTypes: true });
  const unused = entries.filter((entry) => entry.isFile() && !retained.has(entry.name));
  await Promise.all(unused.map((entry) => unlink(new URL(entry.name, IMAGE_DIR))));
  process.stdout.write(`Pruned ${unused.length} unused portraits\n`);
}

async function main() {
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await mkdir(IMAGE_DIR, { recursive: true });
  const titles = await getPopularTitles();
  const pages = await getWikipediaPages(titles);
  const people = await getPeople(pages);
  const withImages = await addImageMetadata(people.slice(0, TARGET_COUNT + 250));
  const selected = withImages.sort((a, b) => b.usScore - a.usScore).slice(0, TARGET_COUNT);
  if (selected.length < TARGET_COUNT) {
    throw new Error(`Only found ${selected.length} eligible people; increase --samples and retry.`);
  }

  const catalog = DOWNLOAD_IMAGES
    ? await mapLimited(selected, 6, async (person, index) => {
      const downloaded = await downloadImage(person);
      if ((index + 1) % 50 === 0) process.stdout.write(`Downloaded ${index + 1}/${selected.length}\n`);
      return downloaded;
    })
    : selected.map((person) => ({ ...person, image: person.imageUrl }));

  if (DOWNLOAD_IMAGES) await pruneUnusedImages(catalog);

  const payload = {
    generatedAt: new Date().toISOString(),
    methodology: `Repeated appearances in United States Wikimedia top-page rankings across ${collectedSampleCount} weekly snapshots; English Wikipedia humans with Commons portraits; excludes people known to have died before 1900.`,
    count: catalog.length,
    celebrities: catalog.map(({ imageUrl, imageMime, imageFile, usViews, usAppearances, usScore, ...person }, index) => ({
      ...person,
      rank: index + 1
    }))
  };
  await writeFile(DATA_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`Wrote ${payload.count} celebrities to ${DATA_PATH.pathname}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
