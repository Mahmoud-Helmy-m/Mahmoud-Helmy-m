// Builds the language-breakdown SVGs from the GitHub GraphQL API.
// Written by hand because lowlighter/metrics' languages plugin reports 0 languages
// for this account (and its repositories section reports 1 repo, when the same
// query returns 26). Run: GITHUB_TOKEN=... node .github/scripts/languages.mjs

const USER = process.env.METRICS_USER ?? "Mahmoud-Helmy-m";
const TOKEN = process.env.GITHUB_TOKEN;
const TOP = 8;
// Categorical slots from the validated theme. Both modes pass every hard gate on
// the adjacent pairlist against GitHub's surfaces (#ffffff / #0d1117):
//   light  worst adjacent CVD dE 9.1, normal-vision dE 19.6
//   dark   worst adjacent CVD dE 8.4, normal-vision dE 19.3
// Three light slots sit under 3:1 contrast, which the legend's visible names and
// percentages relieve.
const SLOTS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const OTHER = { light: "#6e7681", dark: "#8b949e" };

// Colour follows the language, never its position in the ranking - so a month
// where C# overtakes Python does not repaint both. Languages outside this map
// take the lowest free slot in alphabetical order; if none is free they fold
// into "Other" along with everything past the top 8.
const SLOT_OF = {
  Python: 0, "C#": 1, JavaScript: 2, Dart: 3, CSS: 4, C: 5, HTML: 6, Kotlin: 7,
};
function assignSlots(names) {
  const taken = new Set();
  const out = new Map();
  for (const n of names) {
    if (n in SLOT_OF) { out.set(n, SLOT_OF[n]); taken.add(SLOT_OF[n]); }
  }
  for (const n of [...names].filter((n) => !out.has(n)).sort()) {
    const free = SLOTS.light.findIndex((_, i) => !taken.has(i));
    if (free === -1) continue;
    out.set(n, free); taken.add(free);
  }
  return out;
}

const WIDTH = 960;   // matches metrics' `large` display

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const query = `
{
  user(login: "${USER}") {
    repositories(first: 100, affiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        languages(first: 20, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { authorization: `bearer ${TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) {
  console.error(`GraphQL request failed: ${response.status} ${await response.text()}`);
  process.exit(1);
}
const payload = await response.json();
if (payload.errors) {
  console.error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
  process.exit(1);
}

const repositories = payload.data.user.repositories;
const bytes = new Map();
const colors = new Map();
for (const repository of repositories.nodes) {
  for (const { size, node } of repository.languages.edges) {
    bytes.set(node.name, (bytes.get(node.name) ?? 0) + size);
    colors.set(node.name, node.color ?? "#8b949e");
  }
}

const total = [...bytes.values()].reduce((sum, n) => sum + n, 0);
if (!total) {
  console.error("No language bytes returned — refusing to write an empty card");
  process.exit(1);
}

const ranked = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
const shown = ranked.slice(0, TOP);
const otherBytes = ranked.slice(TOP).reduce((sum, [, n]) => sum + n, 0);
const slotOf = assignSlots(shown.map(([name]) => name));
const slices = shown.map(([name, size]) => ({ name, size, slot: slotOf.get(name) }));
if (otherBytes > 0) slices.push({ name: "Other", size: otherBytes, slot: -1 });

const percent = (size) => (100 * size) / total;
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

console.log(`${repositories.totalCount} repositories, ${total.toLocaleString()} bytes`);
for (const slice of slices) {
  console.log(`  ${slice.name.padEnd(14)} ${percent(slice.size).toFixed(2).padStart(6)}%`);
}

function render({ mode, text, muted, background }) {
  const hue = (slice) => (slice.slot === -1 ? OTHER[mode] : SLOTS[mode][slice.slot]);

  const pad = 16;
  const barW = WIDTH - pad * 2;
  const barY = 56;
  const barH = 8;
  const GAP = 2;                 // surface gap between stacked fills

  // Give sub-pixel slivers a 1px floor so a 0.16% language is still visible, then
  // renormalise so the segments still sum to exactly the bar width - clamping
  // alone would push the tail segments into each other.
  const raw = slices.map((s) => Math.max((barW * s.size) / total, 1));
  const scale = barW / raw.reduce((sum, w) => sum + w, 0);

  let x = pad;
  const bar = slices.map((slice, i) => {
    const full = raw[i] * scale;
    // the gap comes out of segments wide enough to survive it
    const w = full > GAP + 1 && i < slices.length - 1 ? full - GAP : full;
    const rect = `<rect x="${x.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" fill="${hue(slice)}"/>`;
    x += full;
    return rect;
  }).join("");

  const COLS = 3;
  const colW = barW / COLS;
  const rowH = 20;
  const legendY = barY + barH + 24;
  const legend = slices.map((slice, i) => {
    const lx = pad + (i % COLS) * colW;
    const ly = legendY + Math.floor(i / COLS) * rowH;
    return `<circle cx="${lx + 5}" cy="${ly - 4}" r="4.5" fill="${hue(slice)}"/>` +
      `<text x="${lx + 17}" y="${ly}" fill="${text}" font-size="12">${escape(slice.name)}</text>` +
      `<text x="${lx + colW - 40}" y="${ly}" fill="${muted}" font-size="12">${percent(slice.size).toFixed(1)}%</text>`;
  }).join("");

  const rows = Math.ceil(slices.length / COLS);
  const height = legendY + rows * rowH + 6;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" role="img" aria-label="Most used languages across ${repositories.totalCount} public repositories: ${slices.map((s) => `${s.name} ${percent(s.size).toFixed(1)} percent`).join(", ")}">
  <text x="${pad}" y="28" fill="${text}" font-size="14" font-weight="600">Most used languages</text>
  <text x="${pad}" y="45" fill="${muted}" font-size="11">across ${repositories.totalCount} public repositories</text>
  <clipPath id="round"><rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="4"/></clipPath>
  <g clip-path="url(#round)">${bar}</g>
  ${legend}
</svg>
`;
}

const { writeFileSync } = await import("node:fs");
writeFileSync("languages.light.svg", render({ mode: "light", text: "#1f2328", muted: "#59636e", background: "#ffffff" }));
writeFileSync("languages.dark.svg", render({ mode: "dark", text: "#e6edf3", muted: "#8b949e", background: "#0d1117" }));
console.log("wrote languages.light.svg and languages.dark.svg");
