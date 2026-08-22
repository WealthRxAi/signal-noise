// Test suite for the SIGNAL/NOISE core. Every fixture below is a REAL title
// pulled from the live ai_news table — including the syndication families and
// the off-topic noise that motivated each heuristic.
import * as L from "./lib.ts";

let fails = 0, passes = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log("PASS  " + name); }
  else { fails++; console.log("FAIL  " + name + (detail ? "  → " + detail : "")); }
}

// ---------------- outlet extraction ----------------
check("domain: strips www + subdomain", L.domainOf("https://www.techcrunch.com/2026/x") === "techcrunch.com");
check("domain: multi-part TLD", L.domainOf("https://news.bbc.co.uk/story") === "bbc.co.uk",
  String(L.domainOf("https://news.bbc.co.uk/story")));
check("outlet: HN link resolves to the real publisher, not 'hackernews'",
  L.outletOf("https://www.bloomberg.com/news/x", "hackernews", "Foo") === "bloomberg.com");
check("outlet: Google News reads publisher off the title suffix",
  L.outletOf("https://news.google.com/rss/articles/CBMi", "googlenews",
    "Top Connecticut court warns lawyers on AI risks after fake citations - Reuters") === "reuters",
  L.outletOf("https://news.google.com/rss/articles/CBMi", "googlenews", "x - Reuters"));
check("title: publisher suffix stripped for display",
  L.cleanTitle("Mistral Is in the Right Place at the Right Time - wired.com", "googlenews")
    === "Mistral Is in the Right Place at the Right Time");
check("title: hyphenated headlines survive on non-GN sources",
  L.cleanTitle("Post-quantum TLS on Cilium Gateway API", "hackernews") === "Post-quantum TLS on Cilium Gateway API");

// ---------------- wire detection ----------------
check("wire: Business Wire flagged", L.isWire("business wire"));
check("wire: PR Newswire flagged", L.isWire("pr newswire"));
check("wire: EIN / Newswise / ipsnews flagged",
  L.isWire("ein news") && L.isWire("newswise") && L.isWire("ipsnews.net"));
check("wire: real newsroom NOT flagged",
  !L.isWire("reuters") && !L.isWire("techcrunch.com") && !L.isWire("nytimes.com") && !L.isWire("wired.com"));

// ---------------- AI relevance ----------------
// These all appeared on the board via HN full-text search for "AI"/"GPT".
const OFF_TOPIC = [
  "Getting a Haircut",
  "FFmpeg 9.0",
  "Why Airplanes Use 400 Hz Power",
  "Search for Life on Europa Just Got Harder",
  "Headlights got brighter, whiter, and more blinding after dark",
  "Stylized GGX Shading",
  "How human hearing is shaping high-end audio",
  "Arsenic, 133 times the legal limit being found in the water around Aughinish",
  "Spherical Codes Application in Fiber Optics (2024)",
];
const ON_TOPIC = [
  "DeepSeek V4 Flash 2.98x faster, lossless",
  "Claude Code Source Code Analysis",
  "LLMs Can't Jump",
  "OpenAI's Unreleased Model Astra Solves Ten Major Open Mathematics Problems",
  "Demand from AI data centers drives up computer memory prices",
  "A fundamental flaw leaves LLMs strikingly vulnerable to attack",
  "Big Tech's Anthropic and OpenAI stakes are distorting the corporate earnings",
  "We gave an AI agent rootless VPN access to 1k live servers",
  "Show HN: Fine-tune an 8B model on a 4 GB laptop GPU",
];
const offKept = OFF_TOPIC.filter((t) => L.isAiRelevant(t, "hackernews"));
const onDropped = ON_TOPIC.filter((t) => !L.isAiRelevant(t, "hackernews"));
check("relevance: off-topic HN noise rejected (" + (OFF_TOPIC.length - offKept.length) + "/" + OFF_TOPIC.length + ")",
  offKept.length === 0, "kept: " + JSON.stringify(offKept));
check("relevance: real AI stories kept (" + (ON_TOPIC.length - onDropped.length) + "/" + ON_TOPIC.length + ")",
  onDropped.length === 0, "dropped: " + JSON.stringify(onDropped));
check("relevance: primary sources always pass", L.isAiRelevant("Some paper title", "arxiv"));
check("relevance: 'AI' matches as a word, not inside 'said'/'maintain'",
  !L.isAiRelevant("He said the chair needs maintenance", "hackernews"));

// ---------------- clustering: real families ----------------
function clusterAll(titles: string[], idf?: Map<string, number>): Map<string, string[]> {
  const c = new L.Clusterer(idf);
  const groups = new Map<string, string[]>();
  titles.forEach((t, i) => {
    const cid = c.assign(L.tokenize(t), "c" + i);
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid)!.push(t);
  });
  return groups;
}

// Family A — one acquisition, five different HN headlines
const AIRTABLE = [
  "Bending Spoons is acquiring Airtable for $1.285B",
  "Bending Spoons to Acquire Airtable",
  "Bending Spoons makes first post-IPO acquisition with $1.3B Airtable deal",
  "Bending Spoons acquires Airtable for 1.285B",
  "Bending Spoons entered definitive agreement to acquire Airtable for $1.28B",
];
let g = clusterAll(AIRTABLE);
check("cluster: 5 Airtable-acquisition headlines → 1 story", g.size === 1,
  g.size + " clusters: " + JSON.stringify([...g.values()].map((v) => v.length)));

// Family B — same press release, different wire outlets (identical text)
const PRESSRELEASE = new Array(6).fill(
  "Real IT Solutions Launches AI Advisory Practice to Help West Michigan Businesses Adopt Artificial Intelligence");
check("cluster: 6 identical syndicated copies → 1 story", clusterAll(PRESSRELEASE).size === 1);

// Family C — KNOWN LIMITATION, asserted so it can't regress silently.
// These two are the same real-world event, but they share exactly one content
// word ("degree"); everything else is different vocabulary. Lexical clustering
// cannot merge them without a threshold loose enough to cause false merges
// across unrelated stories, which is the worse failure for this product.
// Documented in the README as the case that needs embeddings to fix.
const UKDEGREE = [
  "UK's first class of students aiming for a bachelor's degree in artificial intelligence set to begin studies",
  "UK launches inaugural AI degree program this fall",
];
check("cluster: paraphrase with ~1 shared word stays split (known lexical limit)",
  clusterAll(UKDEGREE).size === 2,
  JSON.stringify([...clusterAll(UKDEGREE).values()]));

// Family D — HN vs Google News wording of the same story
const CHINABLITZ = [
  "China's AI blitz creates 'death zone' for rival U.S. model makers",
  "China's AI Blitz Creates 'Death Zone' for Rival US Model Makers",
];
check("cluster: China blitz across HN + press → 1 story", clusterAll(CHINABLITZ).size === 1);

// Family E — the OpenAI math result, two very different headlines
const ASTRA = [
  "OpenAI's Unreleased Model Astra Solves Ten Major Open Mathematics Problems",
  "OpenAI Says Next-Generation Model Solved 10 Major Open Problems in Quantum Complexity, Mathematics",
];
check("cluster: OpenAI Astra math result → 1 story", clusterAll(ASTRA).size === 1,
  JSON.stringify([...clusterAll(ASTRA).values()].map((v) => v.length)));

// ---------------- clustering: must NOT over-merge ----------------
const DISTINCT = [
  "OpenAI has the right strategy, but is unlucky",
  "Apple seeks preliminary injunction against OpenAI in trade secrets case",
  "OpenAI's Unreleased Model Astra Solves Ten Major Open Mathematics Problems",
  "Influencers draw backlash for attending OpenAI's first luxury trip",
  "Letter from 15 Attorneys General to OpenAI [pdf]",
  "How OpenAI built a realtime system for responsive voice AI in six months",
  "Retiring the DALL·E GPT",
  "Bending Spoons is acquiring Airtable for $1.285B",
];
const dg = clusterAll(DISTINCT);
check("cluster: 8 unrelated OpenAI stories stay separate", dg.size === 8,
  dg.size + " clusters: " + JSON.stringify([...dg.values()].filter((v) => v.length > 1)));

const SHOWHN = [
  "Show HN: Evochess – AI feels more like human opponent",
  "Show HN: Draftlight – AI that makes you a better writer (leaves writing to you)",
  "Show HN: A new type of search engine",
  "Show HN: Fine-tune an 8B model on a 4 GB laptop GPU",
  "Show HN: Cull – Interactive TUI disk space analyzer",
];
check("cluster: distinct Show HN posts stay separate", clusterAll(SHOWHN).size === 5,
  JSON.stringify([...clusterAll(SHOWHN).values()].filter((v) => v.length > 1)));

// mixed-corpus regression: families resolve correctly among distractors
const MIXED = [...AIRTABLE, ...DISTINCT.slice(0, 5), ...ASTRA, ...SHOWHN.slice(0, 3), ...CHINABLITZ];
const mg = clusterAll(MIXED);
const airtableCluster = [...mg.values()].find((v) => v.some((t) => t.includes("Airtable") && t.includes("Bending")));
check("cluster: mixed corpus keeps the Airtable family intact (5 members)",
  airtableCluster !== undefined && airtableCluster.length === 5,
  "size " + (airtableCluster?.length));
check("cluster: mixed corpus produces no giant catch-all cluster",
  Math.max(...[...mg.values()].map((v) => v.length)) <= 5);

// ---------------- regressions from PRODUCTION false merges ----------------
// Both of these actually happened on the live board and were caught by
// inspecting cluster membership. They are the reason isMatch refuses to
// cluster on fewer than 3 significant tokens.
const FALSE_MERGE_1 = [
  "Introducing Claude Opus 5",                                          // → {claude, opus} only
  "I asked Claude Opus to recreate The Matrix opening scene in Lego",
];
check("regression: a model launch does not absorb an unrelated post that names it",
  clusterAll(FALSE_MERGE_1).size === 2, JSON.stringify([...clusterAll(FALSE_MERGE_1).values()]));

const FALSE_MERGE_2 = [
  "Introducing the ChatGPT for small business program",
  "Show HN: Open-source tool to check if ChatGPT recommends your business",
];
check("regression: sharing only {chatgpt, business} is not a story match",
  clusterAll(FALSE_MERGE_2).size === 2, JSON.stringify([...clusterAll(FALSE_MERGE_2).values()]));

// The same run also produced this 3-item cluster. It is the honest trade-off:
// these share only the product name, so under the precision-first rule they
// now split into separate stories. They are arguably separate stories anyway
// (a speed claim, a hardware port, a model card). Asserted so the behaviour
// is a decision on record rather than an accident.
const SUBJECT_ONLY = [
  "DeepSeek V4 Flash 2.98x faster, lossless",
  "DeepSeek V4 Flash on a Single AMD MI300X",
  "deepseek-ai/DeepSeek-V4-Flash-0731",
];
check("regression: sharing only a product name splits (precision over recall)",
  clusterAll(SUBJECT_ONLY).size === 3, JSON.stringify([...clusterAll(SUBJECT_ONLY).values()].map((v) => v.length)));

// ---------------- rarity weighting (IDF) ----------------
// A realistic feed corpus: "openai", "model", "gpt" are everywhere; the
// distinctive nouns of any one story are not.
const CORPUS = [
  "OpenAI ships a new model for developers", "OpenAI model update improves reasoning",
  "Anthropic releases a new model", "Google model tops the leaderboard",
  "The model race heats up between OpenAI and Google", "Meta open sources a model",
  "OpenAI model pricing drops again", "A new model beats GPT on coding",
  "GPT usage climbs among developers", "GPT costs fall for enterprises",
  "Mistral model gains traction in Europe", "Model evaluation remains unsolved",
  "OpenAI hiring spree continues", "OpenAI faces new competition",
  "Model context windows keep growing", "Agents built on GPT reach production",
  "Bending Spoons is acquiring Airtable for $1.285B",
  "Nvidia earnings beat expectations on AI demand",
  "Researchers publish a new benchmark for agents",
  "Anthropic model wins on safety evaluations",
];
const idf = L.buildIdf(CORPUS, 1); // force IDF on despite the tiny fixture corpus
check("idf: ubiquitous token weighs less than a rare one",
  (idf.get("model") ?? 9) < (idf.get("airta") ?? 0),
  "model=" + idf.get("model")?.toFixed(2) + " airtable=" + idf.get("airta")?.toFixed(2));

// Sharing only common words must NOT merge two unrelated stories.
const COMMON_ONLY = [
  "OpenAI model pricing drops again",
  "OpenAI model update improves reasoning",
];
check("idf: two stories sharing only common tokens stay separate",
  clusterAll(COMMON_ONLY, idf).size === 2,
  JSON.stringify([...clusterAll(COMMON_ONLY, idf).values()]));

// Sharing rare words must merge even inside the same corpus.
const RARE_SHARED = [
  "Bending Spoons is acquiring Airtable for $1.285B",
  "Bending Spoons acquires Airtable for 1.285B",
];
check("idf: two stories sharing rare tokens merge", clusterAll(RARE_SHARED, idf).size === 1);

// The whole point: real press coverage of one launch, four newsrooms.
const LAUNCH = [
  "OpenAI releases GPT-6 with native agent support",
  "OpenAI's GPT-6 brings native agent support to ChatGPT",
  "GPT-6 arrives: OpenAI adds native agent support across its apps",
];
const lg = clusterAll(LAUNCH, idf);
check("idf: 3 newsrooms covering one launch → 1 story", lg.size === 1,
  lg.size + " clusters: " + JSON.stringify([...lg.values()].map((v) => v.length)));

// Regression: IDF must not break the fixtures above.
check("idf: Airtable family still intact under corpus weighting",
  clusterAll(AIRTABLE, idf).size === 1);
check("idf: unrelated OpenAI stories still separate under corpus weighting",
  clusterAll(DISTINCT, idf).size === 8,
  JSON.stringify([...clusterAll(DISTINCT, idf).values()].filter((v) => v.length > 1)));

// ---------------- clustering stability across runs ----------------
const c1 = new L.Clusterer();
const idsRun1 = AIRTABLE.map((t, i) => c1.assign(L.tokenize(t), "seed" + i));
const c2 = new L.Clusterer();
c2.addSeed(idsRun1[0], L.tokenize(AIRTABLE[0]));               // simulate reload from DB
const idsRun2 = AIRTABLE.map((t) => c2.assign(L.tokenize(t), "NEW"));
check("cluster: reloading seeds reproduces the same cluster id",
  new Set(idsRun1).size === 1 && new Set(idsRun2).size === 1 && idsRun2[0] === idsRun1[0]);

// ---------------- corroboration: the core claim ----------------
check("corroboration: 6 wire copies of one press release = 1, not 6",
  L.corroboration(["morningstar", "guardonline", "voiceofalexandria", "joplinglobe", "heraldpalladium", "financialcontent"], 1) === 1);
check("corroboration: 5 outlets writing their own headline = 5",
  L.corroboration(["techcrunch.com", "bloomberg.com", "reuters", "theverge.com", "wired.com"], 5) === 5);
check("corroboration: 4 outlets but only 2 distinct headlines = 2",
  L.corroboration(["a.com", "b.com", "c.com", "d.com"], 2) === 2);
check("corroboration: single source floors at 1", L.corroboration(["a.com"], 1) === 1);

// ---------------- signal score ----------------
const base = { points: 100, comments: 30, velocity: 0, ageHours: 3, wireOnly: false };
const oneSource = L.signalScore({ ...base, outlets: ["a.com"], titleVariants: 1 });
const sixSource = L.signalScore({ ...base, outlets: ["a", "b", "c", "d", "e", "f"], titleVariants: 6 });
check("score: 6 corroborating outlets outrank 1 at equal engagement", sixSource > oneSource * 1.8,
  oneSource.toFixed(1) + " vs " + sixSource.toFixed(1));

const syndicated = L.signalScore({ ...base, outlets: ["a", "b", "c", "d", "e", "f"], titleVariants: 1 });
check("score: syndicated PR scores like a single source, not like 6", Math.abs(syndicated - oneSource) < 0.01,
  syndicated.toFixed(1) + " vs " + oneSource.toFixed(1));

check("score: wire-only stories score zero",
  L.signalScore({ ...base, outlets: ["businesswire"], titleVariants: 1, wireOnly: true }) === 0);

const fresh = L.signalScore({ ...base, outlets: ["a", "b"], titleVariants: 2, ageHours: 1 });
const stale = L.signalScore({ ...base, outlets: ["a", "b"], titleVariants: 2, ageHours: 40 });
check("score: fresh beats stale at equal corroboration", fresh > stale * 3, fresh.toFixed(1) + " vs " + stale.toFixed(1));

const climbing = L.signalScore({ ...base, outlets: ["a"], titleVariants: 1, velocity: 80 });
check("score: rising engagement lifts a single-source story", climbing > oneSource * 1.5,
  climbing.toFixed(1) + " vs " + oneSource.toFixed(1));

// a quiet, well-corroborated story should beat a loud single-source one
const quietConfirmed = L.signalScore({ outlets: ["a","b","c","d","e"], titleVariants: 5, points: 20, comments: 5, velocity: 0, ageHours: 3, wireOnly: false });
const loudRumor = L.signalScore({ outlets: ["a"], titleVariants: 1, points: 300, comments: 100, velocity: 0, ageHours: 3, wireOnly: false });
check("score: confirmed-but-quiet outranks loud-but-unconfirmed", quietConfirmed > loudRumor,
  quietConfirmed.toFixed(1) + " vs " + loudRumor.toFixed(1));

// ---------------- verdicts & hype ----------------
check("verdict: 3+ independent outlets = CONFIRMED", L.verdict(3, 0.5) === "CONFIRMED");
check("verdict: 2 outlets = DEVELOPING", L.verdict(2, 0.5) === "DEVELOPING");
check("verdict: syndication (corroboration 1) can never be CONFIRMED",
  L.verdict(L.corroboration(["a", "b", "c", "d", "e", "f"], 1), 0.5) !== "CONFIRMED");
check("verdict: lone press item with no primary source = WIRE", L.verdict(1, 5) === "WIRE");
check("verdict: lone primary item = SINGLE SOURCE", L.verdict(1, 0) === "SINGLE SOURCE");
check("hype: all press, no primary → high", L.hypeRatio(6, 0) === 6);
check("hype: press backed by a paper → low", L.hypeRatio(6, 3) === 1.5);

// ---------------- outlet aliasing ----------------
// Every pair below was observed on the LIVE board counting as two independent
// outlets for the same story, which is a direct inflation of the corroboration
// number the verdicts are built on.
const ALIAS_PAIRS: [string, string][] = [
  ["cnbc", "cnbc.com"],
  ["the guardian", "theguardian.com"],
  ["bbc", "bbc.co.uk"],
  ["bbc.com", "bbc.co.uk"],
  ["reuters", "reuters.com"],
  ["the new york times", "nytimes.com"],
  ["wsj", "wsj.com"],
  ["gizmodo", "gizmodo.com"],
  ["africanews", "africanews.com"],
  ["substack", "substack.com"],
  ["broadband breakfast", "broadbandbreakfast"],
  ["the washington post", "washingtonpost.com"],
  ["the verge", "theverge.com"],
  ["The Decoder", "the-decoder.com"],
  ["Financial Times", "ft.com"],
  ["South China Morning Post", "scmp.com"],
];
const unmerged = ALIAS_PAIRS.filter(([a, b]) => L.outletKey(a) !== L.outletKey(b))
  .map(([a, b]) => `${a} (${L.outletKey(a)}) != ${b} (${L.outletKey(b)})`);
check("outlet: masthead and domain resolve to the same key (" + (ALIAS_PAIRS.length - unmerged.length) + "/" + ALIAS_PAIRS.length + ")",
  unmerged.length === 0, JSON.stringify(unmerged));

// The inverse failure is worse: merging two real newsrooms would UNDERSTATE
// corroboration and silently demote genuine CONFIRMED stories.
const DISTINCT_OUTLETS = ["cnbc.com", "cbs news", "nbc news", "theguardian.com", "ft.com",
  "nytimes.com", "washingtonpost.com", "reuters.com", "apnews.com", "techcrunch.com", "theverge.com"];
check("outlet: genuinely different newsrooms keep distinct keys",
  new Set(DISTINCT_OUTLETS.map(L.outletKey)).size === DISTINCT_OUTLETS.length,
  JSON.stringify(DISTINCT_OUTLETS.map((o) => [o, L.outletKey(o)])));

// The live regression, end to end.
const SPACEX_OUTLETS = ["bloomberglaw.com", "cnbc.com", "bbc.co.uk", "bbc", "bbc.com", "cnbc", "the mercury news"];
check("outlet: real CONFIRMED story recounted honestly (was 6, truly 4)",
  L.corroboration(SPACEX_OUTLETS, 9) === 4, String(L.corroboration(SPACEX_OUTLETS, 9)));
check("outlet: single outlet seen twice can never reach DEVELOPING",
  L.corroboration(["broadbandbreakfast", "broadband breakfast"], 2) === 1,
  String(L.corroboration(["broadbandbreakfast", "broadband breakfast"], 2)));
check("outlet: dedupe keeps the domain form for display",
  L.dedupeOutlets(["cnbc", "cnbc.com"]).join() === "cnbc.com",
  JSON.stringify(L.dedupeOutlets(["cnbc", "cnbc.com"])));
check("outlet: dedupe keeps a masthead when no domain form exists",
  L.dedupeOutlets(["cbs news"]).join() === "cbs news");

// ---------------- topics & entities ----------------
check("topic: arXiv is research", L.topicOf("Anything at all", "arxiv") === "research");
check("topic: chips story → hardware",
  L.topicOf("Demand from AI data centers drives up computer memory prices", "hackernews") === "hardware",
  L.topicOf("Demand from AI data centers drives up computer memory prices", "hackernews"));
check("topic: regulation story → policy",
  L.topicOf("EFF Joins Call for FTC to Drop Its Disastrous AI Policy Proposal", "googlenews") === "policy",
  L.topicOf("EFF Joins Call for FTC to Drop Its Disastrous AI Policy Proposal", "googlenews"));
check("topic: acquisition → funding",
  L.topicOf("Bending Spoons is acquiring Airtable for $1.285B", "hackernews") === "funding",
  L.topicOf("Bending Spoons is acquiring Airtable for $1.285B", "hackernews"));
check("topic: jailbreak story → safety",
  L.topicOf("A fundamental flaw leaves LLMs strikingly vulnerable to attack", "hackernews") === "safety",
  L.topicOf("A fundamental flaw leaves LLMs strikingly vulnerable to attack", "hackernews"));

// ---------------- taxonomy widened (was 39% "other" on the live board) ----------------
// Every title below sat in "other" and made THE MAP one giant grey tile.
const RECLASSIFIED: [string, string][] = [
  ["Asian tech stocks drop with SK Hynix plunging 10% after Wall Street AI names fall", "markets"],
  ["The AI Demand Bubble", "markets"],
  ["Amundi says AI remains a long-term bet despite sell-off", "markets"],
  ["Trump's Vision for A.I. Dominance Comes with Major Air Pollution", "energy"],
  ["A Primer to ML Compilers", "engineering"],
  ["How to Build an LLM-Powered Database Query Bot for Your Web App in 1 Day", "engineering"],
  ["Talk, don't type: Big Tech bets AI's future will be spoken", "product"],
  ["AI or real? BBC analyses viral China disaster videos", "media"],
  ["Artificial Intelligence, Artificial Productivity: A Mismatch Made in Corporate America", "jobs"],
];
const misfiled = RECLASSIFIED.filter(([t, want]) => L.topicOf(t, "googlenews") !== want)
  .map(([t, want]) => `${t.slice(0, 34)} → got ${L.topicOf(t, "googlenews")}, want ${want}`);
check("topic: former 'other' stories now classify (" + (RECLASSIFIED.length - misfiled.length) + "/" + RECLASSIFIED.length + ")",
  misfiled.length === 0, JSON.stringify(misfiled));
// Regression: the keyword lists mix plain substrings with word-boundary
// patterns. A keyword written "\bjobs?\b" in TS source is a BACKSPACE
// character at runtime, not a word boundary, so the term silently never
// matches and the story falls through to "other". Each title below depends on
// a \b-anchored keyword being the only hit for its topic.
const BOUNDARY_ANCHORED: [string, string][] = [
  ["AI is coming for entry-level jobs, Stanford finds", "jobs"],
  ["The AI slop flooding your feed is only getting worse", "media"],
  ["Anthropic ships a new API for long-running sessions", "engineering"],
  ["OpenAI adds a cheaper tier for students", "product"],
];
const unanchored = BOUNDARY_ANCHORED.filter(([t, want]) => L.topicOf(t, "googlenews") !== want)
  .map(([t, want]) => `${t.slice(0, 40)} → got ${L.topicOf(t, "googlenews")}, want ${want}`);
check("topic: \\b-anchored keywords compile as real word boundaries",
  unanchored.length === 0, JSON.stringify(unanchored));
// Second pass: vertical adoption was the largest coherent group left in
// "other". Every title below is a real one that sat there.
const VERTICALS: [string, string][] = [
  ["Pretrained AI could help clinics analyze brain MRIs with few labeled scans", "industry"],
  ["Why AI needs real-world insight to transform medical affairs", "industry"],
  ["Six Problems When You Try to Build an AI Therapist", "industry"],
  ["3 key areas where AI will continue to reshape the auto industry", "industry"],
  ["AI Links Mineral Chemistry and Geoscience Data to Guide Exploration", "industry"],
  ["Pattern Leverages AI and Data to Fuel eCommerce Growth", "industry"],
  ["China's tech giants race to put AI on delivery riders' heads", "industry"],
];
const notVertical = VERTICALS.filter(([t, want]) => L.topicOf(t, "googlenews") !== want)
  .map(([t, want]) => `${t.slice(0, 40)} → got ${L.topicOf(t, "googlenews")}, want ${want}`);
check("topic: sector-adoption stories now classify as industry (" + (VERTICALS.length - notVertical.length) + "/" + VERTICALS.length + ")",
  notVertical.length === 0, JSON.stringify(notVertical));
// "industry" must not become the new "other". Bare "the AI industry" is on
// almost every headline, so it is deliberately NOT a keyword.
const NOT_INDUSTRY = [
  "The AI industry is running out of training data",
  "OpenAI releases GPT-6 with native agent support",
  "EU opens consultation on AI Act enforcement",
  "Asian tech stocks drop with SK Hynix plunging 10%",
];
const overreach = NOT_INDUSTRY.filter((t) => L.topicOf(t, "googlenews") === "industry");
check("topic: industry does not swallow generic AI headlines", overreach.length === 0, JSON.stringify(overreach));

check("topic: \\b anchors still reject substring hits",
  L.topicOf("Jobsworth bureaucracy slows AI adoption", "googlenews") !== "jobs",
  L.topicOf("Jobsworth bureaucracy slows AI adoption", "googlenews"));

check("topic: existing categories still win where they should",
  L.topicOf("Demand from AI data centers drives up computer memory prices", "hackernews") === "hardware" &&
  L.topicOf("EFF Joins Call for FTC to Drop Its AI Policy Proposal", "googlenews") === "policy" &&
  L.topicOf("A fundamental flaw leaves LLMs strikingly vulnerable to attack", "hackernews") === "safety",
  [L.topicOf("Demand from AI data centers drives up computer memory prices", "hackernews"),
   L.topicOf("EFF Joins Call for FTC to Drop Its AI Policy Proposal", "googlenews"),
   L.topicOf("A fundamental flaw leaves LLMs strikingly vulnerable to attack", "hackernews")].join(","));

// ---------------- filler filter (real titles seen crowding the 1H view) ----------------
const FILLER_TITLES = [
  "Giuseppe Torzi Explains How Artificial Intelligence Is Transforming Modern Marketing",
  "PKU alumni, Mongolian agencies hold AI and technology exchange event",
  "AI, High-Tech Seen Reshaping Showroom Function & Form",
  "Sungkyunkwan University Undergrad Researcher Develops Drone AI Tech, Published in World-Renowned Academic Journal",
  "Real IT Solutions Launches AI Advisory Practice to Help West Michigan Businesses Adopt AI",
  "Business Intelligence Group Names BostonGene Outstanding Organization in AI Excellence Awards",
  "Rapid Nutrition Joins Global Conversation on the Future of AI-Driven HealthTech",
];
const KEEP_TITLES = [
  "DeepSeek Plans 'Significant' Price Increase for Its AI Services",
  "OpenAI Models Joined Forces Months Ahead of Hugging Face Hack",
  "Top Connecticut court warns lawyers on AI risks after fake citations",
  "Google DeepMind Disbands AlphaFold Team as AI Strategy Shifts",
  "Anthropic says its AI models hacked 3 organizations during testing",
  "EU opens consultation on AI Act enforcement",
];
const fillerMissed = FILLER_TITLES.filter((t) => !L.isFiller(t, "googlenews"));
const goodDropped = KEEP_TITLES.filter((t) => L.isFiller(t, "googlenews"));
check("filler: PR/trade filler caught (" + (FILLER_TITLES.length - fillerMissed.length) + "/" + FILLER_TITLES.length + ")",
  fillerMissed.length === 0, JSON.stringify(fillerMissed));
check("filler: real news never dropped", goodDropped.length === 0, JSON.stringify(goodDropped));
check("filler: scoped to Google News only — other feeds are untouchable",
  !L.isFiller(FILLER_TITLES[0], "hackernews") && !L.isFiller(FILLER_TITLES[0], "techcrunch"));

check("entity: Claude → anthropic", L.entitiesOf("Claude Code Source Code Analysis").includes("anthropic"));
check("entity: two labs in one headline",
  ["openai", "anthropic"].every((x) => L.entitiesOf("Big Tech's Anthropic and OpenAI stakes are distorting earnings").includes(x)));
check("entity: Gemini → google", L.entitiesOf("Google Gemini AI or ChatGPT").includes("google"));
check("entity: no false positive on unrelated headline", L.entitiesOf("Kubo v0.43.0 Released").length === 0,
  JSON.stringify(L.entitiesOf("Kubo v0.43.0 Released")));

// ---------------- source classification ----------------
const cls = L.classifySources(["arxiv", "openai", "googlenews", "techcrunch", "hackernews"]);
check("classify: primary / press / community split",
  cls.primary === 2 && cls.press === 2 && cls.community === 1, JSON.stringify(cls));

console.log("\n" + passes + " passed, " + fails + " failed");
if (fails) { console.log("SUITE FAILED"); (globalThis as any).process?.exit(1); }
else console.log("ALL TESTS PASSED");
