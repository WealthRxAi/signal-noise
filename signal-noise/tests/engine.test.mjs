// End-to-end test of the ingest worker with the network and Supabase mocked.
// Verifies the claims the product is named after, on a realistic mixed feed.
import fs from "fs";

const NOW = Date.now();
const iso = (h) => new Date(NOW - h * 3600e3).toISOString();
let fails = 0, passes = 0;
const check = (n, c, d) => { if (c) { passes++; console.log("PASS  " + n); } else { fails++; console.log("FAIL  " + n + (d ? "  → " + d : "")); } };

// ---- the scenario ----
// STORY A: one product launch, four independent newsrooms, four headlines → CONFIRMED
const pressStory = {
  techcrunch: "OpenAI releases GPT-6 with native agent support",
  verge: "OpenAI's GPT-6 brings native agent support to ChatGPT",
  wired: "GPT-6 arrives: OpenAI adds native agent support across its apps",
  venturebeat: "OpenAI ships GPT-6 with native agent support for enterprises",
};
const rssItem = (title, link, hoursAgo) =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${new Date(NOW - hoursAgo * 3600e3).toUTCString()}</pubDate></item>`;
const rssFeed = (items) => `<?xml version="1.0"?><rss><channel>${items.join("")}</channel></rss>`;

// STORY B: one press release, five syndicating outlets, IDENTICAL text → must NOT be CONFIRMED
const PR_TITLE = "Real IT Solutions Launches AI Advisory Practice to Help West Michigan Businesses Adopt Artificial Intelligence";
const prOutlets = ["Morningstar", "guardonline.com", "Voice of Alexandria", "The Joplin Globe", "The Herald Palladium"];
const SYND_TITLE = "Nexa Systems reports record quarterly AI revenue growth";
const gnewsFeed = rssFeed([
  ...prOutlets.map((o, i) => rssItem(`${PR_TITLE} - ${o}`, `https://news.google.com/rss/articles/PR${i}?oc=5`, 2)),
  ...prOutlets.map((o, i) => rssItem(`${SYND_TITLE} - ${o}`, `https://news.google.com/rss/articles/SY${i}?oc=5`, 2)),
  rssItem("Top Connecticut court warns lawyers on AI risks after fake citations - Reuters",
    "https://news.google.com/rss/articles/CT1?oc=5", 3),
]);

// STORY C: single-source lab post → SINGLE SOURCE
const openaiFeed = rssFeed([rssItem("Introducing a new evaluation suite", "https://openai.com/index/evals", 1)]);

// HN: off-topic noise that must be filtered, plus an engaged AI story
const hnHits = {
  hits: [
    { title: "Getting a Haircut", url: "https://example.com/haircut", points: 400, num_comments: 200, created_at: iso(1), objectID: "n1" },
    { title: "Why Airplanes Use 400 Hz Power", url: "https://example.com/400hz", points: 300, num_comments: 90, created_at: iso(2), objectID: "n2" },
    { title: "FFmpeg 9.0", url: "https://example.com/ffmpeg", points: 250, num_comments: 80, created_at: iso(2), objectID: "n3" },
    { title: "A fundamental flaw leaves LLMs strikingly vulnerable to attack", url: "https://arstechnica.com/llm-flaw", points: 512, num_comments: 210, created_at: iso(2), objectID: "n4" },
    { title: "OpenAI releases GPT-6 with native agent support", url: "https://techcrunch.com/2026/gpt6?utm_source=hn", points: 640, num_comments: 300, created_at: iso(2), objectID: "n5" },
  ],
};

const FEED_FOR = (url) => {
  if (url.includes("hn.algolia")) return JSON.stringify(hnHits);
  if (url.includes("techcrunch.com/category")) return rssFeed([rssItem(pressStory.techcrunch, "https://techcrunch.com/2026/gpt6", 2)]);
  if (url.includes("theverge.com")) return rssFeed([rssItem(pressStory.verge, "https://www.theverge.com/2026/gpt6", 2)]);
  if (url.includes("wired.com")) return rssFeed([rssItem(pressStory.wired, "https://www.wired.com/story/gpt6", 2)]);
  if (url.includes("venturebeat.com")) return rssFeed([rssItem(pressStory.venturebeat, "https://venturebeat.com/ai/gpt6", 2)]);
  if (url.includes("news.google.com")) return gnewsFeed;
  if (url.includes("openai.com/news")) return openaiFeed;
  if (url.includes("arstechnica")) throw new Error("HTTP 503");            // dead feed, must be isolated
  return rssFeed([]);
};

// ---- mocks ----
const captured = { ai_news: [], signal_stories: [], quotes: [], deletes: [] };
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srk" }[k]) },
  serve: (fn) => { globalThis.__served = fn; },
};
// stand-in for the edge runtime's built-in gte-small model
let embedCalls = 0;
globalThis.Supabase = { ai: { Session: class {
  async run(text) { embedCalls++; return new Array(384).fill(0).map((_, i) => ((text.charCodeAt(i % text.length) % 17) - 8) / 32); }
} } };
globalThis.fetch = async (url, opts = {}) => {
  const ok = (body, okFlag = true, status = 200) => ({ ok: okFlag, status, text: async () => body, json: async () => JSON.parse(body) });
  if (url.includes("fake.supabase.co")) {
    const m = (opts.method || "GET").toUpperCase();
    if (m === "GET") return ok("[]");                                       // cold start: empty table
    if (m === "DELETE") { captured.deletes.push(url); return ok("", true, 204); }
    if (url.includes("/ai_news")) { captured.ai_news.push(...JSON.parse(opts.body)); return ok("", true, 201); }
    if (url.includes("/signal_stories")) { captured.signal_stories.push(...JSON.parse(opts.body)); return ok("", true, 201); }
    if (url.includes("/ai_quotes")) { captured.quotes.push(...JSON.parse(opts.body)); return ok("", true, 201); }
    if (url.includes("/rpc/apply_semantic_merges")) { captured.merged = true; return ok("0"); }
  }
  if (url.includes("finance.yahoo.com")) {
    return ok(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 200, chartPreviousClose: 190 } }] } }));
  }
  if (url.includes("stooq.com")) return ok("Symbol,Date,Time,Open,High,Low,Close,Volume\nX,2026-08-04,16:00,100,1,1,110,1");
  if (url.includes("reddit.com")) return ok("403", false, 403);
  try { return ok(FEED_FOR(url)); } catch (e) { return ok(String(e.message), false, 503); }
};

await import("/tmp/engine.mjs");
const res = await globalThis.__served(new Request("https://x/"));
const summary = JSON.parse(await res.text());

// ---- assertions ----
const stories = captured.signal_stories;
const byTitle = (frag) => stories.find((s) => s.title.toLowerCase().includes(frag.toLowerCase()));

console.log("\n-- run summary --");
console.log(JSON.stringify({ fetched: summary.fetched, kept: summary.kept, dropped_offtopic: summary.dropped_offtopic, stories: summary.stories, confirmed: summary.confirmed }, null, 1));

check("off-topic HN noise filtered out of the item table",
  !captured.ai_news.some((r) => /Haircut|400 Hz|FFmpeg/.test(r.title)),
  captured.ai_news.filter((r) => /Haircut|400 Hz|FFmpeg/.test(r.title)).map((r) => r.title).join(", "));
check("dropped_offtopic counted", summary.dropped_offtopic >= 3, String(summary.dropped_offtopic));

const gpt6 = byTitle("GPT-6");
check("4 newsrooms + HN collapse into ONE story", gpt6 !== undefined && stories.filter((s) => /GPT-6/.test(s.title)).length === 1,
  "clusters mentioning GPT-6: " + stories.filter((s) => /GPT-6/.test(s.title)).length);
check("that story is CONFIRMED (>=4 independent outlets)", gpt6?.verdict === "CONFIRMED",
  gpt6 ? `verdict=${gpt6.verdict} corroboration=${gpt6.corroboration} outlets=${JSON.stringify(gpt6.outlets)}` : "missing");
check("HN link resolved to techcrunch.com, not 'hackernews'",
  gpt6 !== undefined && gpt6.outlets.includes("techcrunch.com") && !gpt6.outlets.includes("hackernews"),
  JSON.stringify(gpt6?.outlets));
check("engagement aggregated across the cluster", (gpt6?.points || 0) >= 640, String(gpt6?.points));

// vendor-PR filler is now removed before it can become a story at all
check("trade-press filler dropped before scoring", byTitle("Real IT Solutions") === undefined);
check("dropped_filler counted", summary.dropped_filler >= 1, String(summary.dropped_filler));

// ...but ordinary syndication still has to collapse to corroboration 1
const pr = byTitle("Nexa Systems");
check("syndicated story exists", pr !== undefined);
check("...but 5 syndicating outlets score corroboration 1, NOT 5", pr?.corroboration === 1,
  pr ? `corroboration=${pr.corroboration} outlets=${pr.outlets.length} variants=${pr.variants}` : "missing");
check("...and is never labelled CONFIRMED", pr?.verdict !== "CONFIRMED", pr?.verdict);
check("...and scores below the genuinely corroborated story", (pr?.signal || 0) < (gpt6?.signal || 0),
  `pr=${pr?.signal} gpt6=${gpt6?.signal}`);

const lab = byTitle("evaluation suite");
check("single lab post = SINGLE SOURCE", lab?.verdict === "SINGLE SOURCE", lab?.verdict);

check("dead feed isolated, run still completed", String(summary.stats["arstechnica"]).startsWith("ERROR") && summary.stories > 0,
  String(summary.stats["arstechnica"]));
check("Google News publisher parsed off title suffix",
  stories.some((s) => s.outlets.includes("reuters")), JSON.stringify(stories.map((s) => s.outlets).flat()));
check("Google News suffix stripped from display title",
  !stories.some((s) => / - Reuters$/.test(s.title)));
check("topics assigned", stories.every((s) => typeof s.topic === "string" && s.topic.length > 0));
check("entities extracted (openai on the GPT-6 story)", (gpt6?.entities || []).includes("openai"), JSON.stringify(gpt6?.entities));
check("quotes still upserted alongside news", captured.quotes.length === 6, String(captured.quotes.length));
check("both tables pruned", captured.deletes.length === 2);
check("every item row carries a cluster_id", captured.ai_news.every((r) => !!r.cluster_id));
// Embedding + semantic merge deliberately do NOT run here — they live in
// signal-noise-embed, because model inference in this invocation exceeded the
// worker compute budget once the source list reached 47 feeds.
check("ingest does no model inference", embedCalls === 0, String(embedCalls));
check("every upserted row has an identical key set (PGRST102 guard)",
  new Set(captured.ai_news.map((r) => Object.keys(r).sort().join(","))).size === 1);

console.log("\ntop stories by signal:");
for (const s of stories.slice().sort((a, b) => b.signal - a.signal).slice(0, 6)) {
  console.log(`  ${String(s.signal).padStart(6)}  ${s.verdict.padEnd(13)} x${s.corroboration}  ${s.title.slice(0, 62)}`);
}
console.log("\n" + passes + " passed, " + fails + " failed");
if (fails) { console.log("ENGINE SUITE FAILED"); process.exit(1); }
console.log("ENGINE SUITE PASSED");
