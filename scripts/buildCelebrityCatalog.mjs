import { access, mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = new URL("../", import.meta.url);
const DATA_PATH = new URL("../data/celebrities.json", import.meta.url);
const IMAGE_DIR = new URL("../assets/celebrities/", import.meta.url);
const USER_AGENT = "EricensenFaceCards/1.0 (https://github.com/ericensen/Ericensen)";
const TARGET_COUNT = Number(process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] || 1000);
const DOWNLOAD_IMAGES = process.argv.includes("--download-images");
const MONTH_COUNT = Number(process.argv.find((arg) => arg.startsWith("--months="))?.split("=")[1] || 48);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: { "Api-User-Agent": USER_AGENT, "User-Agent": USER_AGENT }
  });
  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 5) throw new Error(`Request failed (${response.status}): ${url}`);
    await sleep(500 * (2 ** attempt));
    return getJson(url, attempt + 1);
  }
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

function recentCompleteMonths(count) {
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  return Array.from({ length: count }, () => {
    const month = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 };
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    return month;
  });
}

async function getPopularTitles() {
  const totals = new Map();
  for (const { year, month } of recentCompleteMonths(MONTH_COUNT)) {
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access/${year}/${String(month).padStart(2, "0")}/all-days`;
    const data = await getJson(url);
    for (const article of data.items?.[0]?.articles || []) {
      const title = article.article.replaceAll("_", " ");
      if (title.startsWith("Special:") || title === "Main Page" || title === "-" || title.includes("List of")) continue;
      totals.set(title, (totals.get(title) || 0) + article.views);
    }
    process.stdout.write(`Collected ${year}-${String(month).padStart(2, "0")}\n`);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(4500, TARGET_COUNT * 5))
    .map(([title, views]) => ({ title, views }));
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
          views: ranked?.views || 0,
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
        views: page.views
      });
    }
    await sleep(45);
  }
  return people.sort((a, b) => b.views - a.views);
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

async function downloadImage(person) {
  const extension = extensionFor(person);
  const fileName = `${person.id}${extension}`;
  try {
    await access(new URL(fileName, IMAGE_DIR));
    return { ...person, image: `assets/celebrities/${fileName}` };
  } catch {
    // The portrait is not cached locally yet.
  }
  const response = await fetch(person.imageUrl, { headers: { "User-Agent": USER_AGENT } });
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

async function main() {
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await mkdir(IMAGE_DIR, { recursive: true });
  const titles = await getPopularTitles();
  const pages = await getWikipediaPages(titles);
  const people = await getPeople(pages);
  const withImages = await addImageMetadata(people.slice(0, TARGET_COUNT + 250));
  const selected = withImages.sort((a, b) => b.views - a.views).slice(0, TARGET_COUNT);
  if (selected.length < TARGET_COUNT) {
    throw new Error(`Only found ${selected.length} eligible people; increase --months and retry.`);
  }

  const catalog = DOWNLOAD_IMAGES
    ? await mapLimited(selected, 6, async (person, index) => {
      const downloaded = await downloadImage(person);
      if ((index + 1) % 50 === 0) process.stdout.write(`Downloaded ${index + 1}/${selected.length}\n`);
      return downloaded;
    })
    : selected.map((person) => ({ ...person, image: person.imageUrl }));

  const payload = {
    generatedAt: new Date().toISOString(),
    methodology: `Top English Wikipedia page views across ${MONTH_COUNT} complete months; humans with Wikimedia Commons portraits; excludes people known to have died before 1900.`,
    count: catalog.length,
    celebrities: catalog.map(({ imageUrl, imageMime, imageFile, views, ...person }, index) => ({
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
