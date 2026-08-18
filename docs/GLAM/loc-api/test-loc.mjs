// Standalone test for Library of Congress image search logic.
// Replicates the core of the provider module without rate-limit / types deps.
// Network fetch uses curl.exe + SOCKS5 proxy (Node fetch lacks SOCKS5 support).

import { execFileSync } from "node:child_process";

const PROXY = "127.0.0.1:7890";
const QUERY = process.argv[2] || "vintage car";
const MAX = Number(process.argv[3] || 5);

function pickImageUrl(r) {
  const iu = r.image_url;
  if (!iu) return undefined;
  if (typeof iu === "string") return iu;
  if (Array.isArray(iu) && iu.length > 0) {
    return iu.reduce(
      (a, b) => (String(b).length > String(a).length ? b : a),
      iu[0],
    );
  }
  return undefined;
}

function pickAuthor(r) {
  const c = r.contributor ?? r.creator;
  if (!c) return undefined;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.length > 0) return String(c[0]);
  return undefined;
}

function mapRights(raw) {
  if (!raw) return "PUBLIC_DOMAIN";
  const s = String(Array.isArray(raw) ? raw[0] : raw).toLowerCase();
  if (s.includes("no known restrictions") || s.includes("public domain")) return "PUBLIC_DOMAIN";
  if (s.includes("cc0") || s.includes("publicdomain/zero")) return "CC0";
  if (
    s.includes("rights") &&
    (s.includes("restrict") || s.includes("may apply") || s.includes("copyright"))
  )
    return "UNKNOWN";
  return "UNKNOWN";
}

async function search(query, max = 25) {
  const fa = "original-format:photo, print, drawing|original-format:film, video";
  const args = [
    "-s", "-L",
    "--socks5-hostname", PROXY,
    "--max-time", "30",
    "-G", "https://www.loc.gov/search/",
    "--data-urlencode", "fo=json",
    "--data-urlencode", `q=${query}`,
    "--data-urlencode", `fa=${fa}`,
    "--data-urlencode", `c=${max}`,
  ];

  console.log("--- Request (curl -G --data-urlencode) ---");
  console.log("  fa =", fa);
  console.log("");

  const stdout = execFileSync("curl.exe", args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (!stdout.trim()) throw new Error("curl returned empty response");
  const json = JSON.parse(stdout);

  const results = json?.results ?? [];
  console.log(`--- API returned ${results.length} results (pagination total: ${json?.pagination?.total ?? "n/a"}) ---`);
  console.log("");

  const out = [];
  for (const r of results) {
    const imgUrl = pickImageUrl(r);
    if (!imgUrl) continue;
    const license = mapRights(r.rights ?? r.rights_information ?? r.rights_advisory);
    out.push({
      url: imgUrl,
      sourcePageUrl: r.url ?? r.id,
      title:
        typeof r.title === "string" ? r.title : Array.isArray(r.title) ? r.title[0] : undefined,
      author: pickAuthor(r),
      license,
      licenseUrl: typeof r.rights === "string" ? r.rights : undefined,
      confidence: license === "PUBLIC_DOMAIN" ? 0.85 : 0.2,
      rawRights: r.rights ?? r.rights_information ?? r.rights_advisory ?? null,
    });
  }
  return out;
}

// --- unit tests for mapRights ---
console.log("=== Unit tests: mapRights ===");
const cases = [
  [undefined, "PUBLIC_DOMAIN"],
  [null, "PUBLIC_DOMAIN"],
  ["No known restrictions on publication.", "PUBLIC_DOMAIN"],
  ["Public domain", "PUBLIC_DOMAIN"],
  ["CC0", "CC0"],
  ["Rights status may apply", "UNKNOWN"],
  ["Copyright restrictions apply", "UNKNOWN"],
  ["Some ambiguous text", "UNKNOWN"],
  [["No known restrictions", "other"], "PUBLIC_DOMAIN"],
];
let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const got = mapRights(input);
  const ok = got === expected;
  console.log(`  ${ok ? "PASS" : "FAIL"}  mapRights(${JSON.stringify(input)}) = ${got} (expected ${expected})`);
  ok ? pass++ : fail++;
}
console.log(`  => ${pass} passed, ${fail} failed`);
console.log("");

// --- live API test ---
console.log(`=== Live API test: query="${QUERY}", max=${MAX} ===`);
try {
  const candidates = await search(QUERY, MAX);
  console.log(`--- Extracted ${candidates.length} image candidates ---`);
  console.log("");
  candidates.forEach((c, i) => {
    console.log(`[${i + 1}] ${c.title ?? "(no title)"}`);
    console.log(`    author : ${c.author ?? "(none)"}`);
    console.log(`    license: ${c.license} (confidence ${c.confidence})`);
    console.log(`    rights : ${c.rawRights ?? "(none)"}`);
    console.log(`    image  : ${c.url}`);
    console.log(`    page   : ${c.sourcePageUrl ?? "(none)"}`);
    console.log("");
  });

  // summary stats
  const byLicense = {};
  for (const c of candidates) byLicense[c.license] = (byLicense[c.license] || 0) + 1;
  console.log("--- License distribution ---");
  console.log(JSON.stringify(byLicense, null, 2));
} catch (err) {
  console.error("ERROR:", err.message);
  process.exit(1);
}
