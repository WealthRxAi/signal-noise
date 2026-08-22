// ============================================================
// SIGNAL / NOISE — core scoring library
// Pure, dependency-free, deterministic. Shared by the edge
// function and the test suite. No I/O in this file.
// ============================================================

// ---------------- outlets ----------------

const MULTI_TLD = new Set([
  "co.uk", "com.au", "co.jp", "co.nz", "co.in", "com.br", "co.za", "org.uk", "ac.uk", "gov.uk", "com.cn",
]);

/** Registrable domain of a URL: news.bbc.co.uk -> bbc.co.uk */
export function domainOf(url: string): string | null {
  let h: string;
  try { h = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join(".");
  return MULTI_TLD.has(last2) ? parts.slice(-3).join(".") : last2;
}

/**
 * The real publisher behind an item.
 * Feeds are transports, not outlets: an HN post linking to techcrunch.com
 * is a TechCrunch story. Google News hides the publisher behind a redirect
 * URL but appends it to the title (" - Reuters").
 */
export function outletOf(url: string, source: string, title: string): string {
  if (source === "googlenews") {
    const m = title.match(/\s[-–—]\s([^-–—]{2,60})$/);
    if (m) return m[1].trim().toLowerCase().replace(/\.(com|net|org|co|io|ai)$/i, "");
  }
  const d = domainOf(url);
  if (!d) return source;
  // aggregator/self-post domains are the aggregator itself, not an outlet
  return d;
}

/**
 * Outlets arrive in two incompatible shapes and MUST be unified before they
 * are counted.
 *
 * An RSS or Hacker News link resolves to a domain ("cnbc.com"). The same
 * newsroom reached through Google News resolves to the human name in the
 * title suffix ("CNBC"). Left alone, one outlet counts as two, and since
 * corroboration is literally a count of distinct outlets, that inflates the
 * headline number this whole product rests on. Observed live: a story carried
 * only by Broadband Breakfast scored corroboration 2 and was labelled
 * DEVELOPING, on the strength of "broadbandbreakfast" and
 * "broadband breakfast" being different strings.
 *
 * The key is the stem: drop the TLD, drop punctuation and spaces, drop a
 * leading "the" (so "The Guardian" and "theguardian.com" agree). An alias
 * table covers the cases where a masthead simply is not its domain.
 */
const OUTLET_ALIASES: Record<string, string> = {
  newyorktimes: "nytimes", nyt: "nytimes",
  wallstreetjournal: "wsj",
  financialtimes: "ft",
  southchinamorningpost: "scmp",
  losangelestimes: "latimes",
  associatedpress: "apnews", ap: "apnews",
  timesofindia: "indiatimes",
  washingtonpost: "washingtonpost",
  msnbc: "nbcnews",
};

export function outletKey(outlet: string): string {
  let k = String(outlet || "").toLowerCase().trim();
  // A domain has no spaces; a masthead may. Only stem the domain form.
  const dot = k.indexOf(".");
  if (dot > 0 && !k.includes(" ")) k = k.slice(0, dot);
  k = k.replace(/[^a-z0-9]/g, "").replace(/^the/, "");
  return OUTLET_ALIASES[k] || k;
}

/**
 * Collapse aliases to one entry each, preferring the domain form for display
 * because it is unambiguous in a dense terminal row ("cnbc.com" beats "CNBC"
 * when the row beside it says "cbs news").
 */
export function dedupeOutlets(outlets: string[]): string[] {
  const best = new Map<string, string>();
  for (const o of outlets) {
    if (!o) continue;
    const k = outletKey(o);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur || (!cur.includes(".") && o.includes("."))) best.set(k, o);
  }
  return [...best.values()];
}

/** Google News appends " - Publisher"; strip it for display. */
export function cleanTitle(title: string, source: string): string {
  let t = String(title || "").trim();
  if (source === "googlenews") t = t.replace(/\s[-–—]\s[^-–—]{2,60}$/, "").trim();
  return t.replace(/\s+/g, " ");
}

/**
 * Press-release wires and syndication mills. These republish the same
 * corporate announcement verbatim across dozens of "outlets" — the exact
 * pattern that fools naive source-counting into calling PR a top story.
 */
// Deliberately limited to true PR-distribution services. Real newspapers that
// happen to run syndicated copy (Globe and Mail, Benzinga) are NOT listed —
// the outlets-vs-variants rule already neutralises syndication without
// blacklisting legitimate newsrooms.
const WIRE = [
  "businesswire", "prnewswire", "globenewswire", "einnews", "einpresswire", "newswise", "accesswire",
  "ipsnews", "financialcontent", "issuewire", "openpr", "prweb", "247pressrelease", "presseportal",
  "marketsbusinessinsider", "finanznachrichten", "streetinsider", "stocktitan", "quantisnow",
  "menafn", "digitaljournal", "pressrelease",
];
export function isWire(outlet: string): boolean {
  // outlets arrive as both domains ("prnewswire.com") and title suffixes
  // ("PR Newswire") — flatten both to the same comparable form
  const o = outlet.toLowerCase().replace(/[^a-z0-9]/g, "");
  return WIRE.some((w) => o.includes(w));
}

// ---------------- AI relevance ----------------

// Word-boundary terms. "AI" must be its own token so "said"/"maintain" don't match.
const AI_TERMS = [
  "\\bai\\b", "\\ba\\.i\\.", "artificial intelligence", "\\bllms?\\b", "\\bgpt", "\\bchatgpt\\b", "claude",
  "gemini", "\\bllama\\b", "mistral", "anthropic", "openai", "deepmind", "deepseek", "\\bqwen\\b", "\\bgrok\\b",
  "hugging ?face", "transformer", "neural", "machine learning", "deep learning", "\\bml\\b", "\\bagi\\b",
  "generative", "\\bagentic?\\b", "\\bagents?\\b", "diffusion", "inference", "fine-?tun", "\\brag\\b",
  "embedding", "\\bmodels?\\b", "chatbot", "copilot", "\\bnlp\\b", "prompt", "\\btoken", "benchmark",
  "\\bgpus?\\b", "\\bnvidia\\b", "\\btpus?\\b", "superintelligence", "alignment", "\\bmcp\\b", "\\bsora\\b",
  "midjourney", "stable diffusion", "\\bcursor\\b", "\\bcodex\\b", "\\bopus\\b", "\\bsonnet\\b",
];
const AI_RE = new RegExp(AI_TERMS.join("|"), "i");

/** Sources that are AI-native by definition — everything they publish qualifies. */
const PRIMARY_AI_SOURCES = new Set([
  "arxiv", "openai", "anthropic", "deepmind", "googleresearch", "huggingface", "mistral", "cohere", "ollama",
  "googleblogai", "metaai", "awsml", "bair",
]);

/**
 * HN's search matches body text, so a query for "AI" drags in
 * "Why Airplanes Use 400 Hz Power". Require the *title* to be about AI.
 */
export function isAiRelevant(title: string, source: string): boolean {
  if (PRIMARY_AI_SOURCES.has(source)) return true;
  return AI_RE.test(title);
}

/**
 * Trade-press and local-PR filler.
 *
 * These clear the AI-relevance test because they do mention AI, but they are
 * vendor thought-leadership, regional event notices and award announcements —
 * observed crowding the 1H view from Kitchen & Bath Design News, China Daily
 * and similar. Scoped deliberately to Google News, which is where all of it
 * arrives: a scoop from a small independent blog on any other feed cannot be
 * caught by this.
 */
const FILLER = [
  /\bexplains? (how|why)\b/i,
  /\b(is|are) transforming\b/i,
  /\bhow (ai|artificial intelligence) (is|will|could) (transform|reshap|revolution|chang|disrupt)/i,
  /\bexchange event\b|\bnetworking event\b|\btrade show\b|\bexpo\b/i,
  /world[- ]renowned/i,
  /\blaunches?\b[^.]{0,60}\b(practice|advisory|initiative|program|solution)s?\b[^.]{0,25}\bto help\b/i,
  /\b(award|awards)\b[^.]{0,35}\b(winner|excellence|honou?red)\b/i,
  /\bnames?\b[^.]{0,45}\b(outstanding|excellence)\b/i,
  /\b(seen|poised) (reshaping|to reshape|to transform)\b/i,
  /\bribbon[- ]cutting\b|\bgroundbreaking ceremony\b/i,
  /\bjoins? global conversation\b|\bthought leader\b/i,
];

export function isFiller(title: string, source: string): boolean {
  if (source !== "googlenews") return false;
  return FILLER.some((re) => re.test(title));
}

// ---------------- tokenization ----------------

const STOP = new Set(`a an the and or but for with from that this these those its it is are was were be been being
of in on at to by as into over under after before about than then they them their there here you your our we us
he she his her not no all out up down off just now new news says say said how why what when where who which will
would could should can may might must have has had do does did get got make makes made take takes new more most
some any one two three first last next best top big small good great how-to via using use used
ai artificial intelligence tech technology report reports update updates launch launches launched announce
announces announced introducing introduces company companies inc corp ltd llc year years today week month`
  .split(/\s+/).filter(Boolean));

/**
 * Aggressive stem: same story, different headline uses different word forms
 * ("acquire" / "acquiring" / "acquisition"). Truncating to a 5-char prefix
 * collapses those to one token — crude, but it's what makes clustering work
 * across outlets that never copy each other's phrasing.
 */
function stem(tok: string): string {
  return tok.length > 5 ? tok.slice(0, 5) : tok;
}

/** Significant, stemmed token set used for near-duplicate matching. */
export function tokenize(title: string): string[] {
  const raw = String(title || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const out = new Set<string>();
  for (const t of raw) {
    if (t.length < 3) continue;
    if (STOP.has(t)) continue;
    out.add(stem(t));
  }
  return [...out];
}

/** Exact-duplicate key: identical headline text (syndication detector). */
export function titleKey(title: string): string {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------------- similarity ----------------

/**
 * Inverse document frequency over the current corpus.
 *
 * Two headlines sharing "openai" and "model" is almost no evidence — in an AI
 * feed those words are everywhere. Two sharing "bending" and "airtable" is
 * near-proof. Weighting by rarity is what separates those cases, and it lets
 * the match threshold sit low enough to catch real paraphrases without
 * merging every story that happens to mention the same lab.
 */
export const MIN_CORPUS_FOR_IDF = 200;

export function buildIdf(titles: string[], minCorpus = MIN_CORPUS_FOR_IDF): Map<string, number> {
  // On a small corpus IDF actively backfires. The distinctive words of a story
  // covered by five outlets appear five times, so IDF rates them "common" and
  // suppresses the very tokens that prove corroboration. Below this size an
  // empty map is returned, which makes every token weigh the same.
  if (titles.length < minCorpus) return new Map();
  const df = new Map<string, number>();
  for (const t of titles) for (const tok of tokenize(t)) df.set(tok, (df.get(tok) || 0) + 1);
  const N = titles.length;
  const idf = new Map<string, number>();
  for (const [tok, n] of df) idf.set(tok, Math.log(1 + N / n));
  return idf;
}

/** Absent a corpus every token weighs the same, which degrades to plain containment. */
const DEFAULT_WEIGHT = 1.4;
const w = (tok: string, idf?: Map<string, number>) => (idf ? (idf.get(tok) ?? Math.log(2)) : DEFAULT_WEIGHT);

export function sharedCount(a: string[], b: string[]): number {
  const set = new Set(b);
  let n = 0;
  for (const t of a) if (set.has(t)) n++;
  return n;
}

/**
 * Rarity-weighted Dice coefficient — symmetric by construction.
 *
 * Containment (shared / smaller set) was tried first and is wrong here: a
 * 3-token headline sharing 2 tokens scores 0.67 against ANYTHING, which is
 * exactly how "Introducing the ChatGPT for small business program" ended up
 * merged with an unrelated Show HN post on the live board. Dice divides by
 * both sides, so a match must be substantial from both headlines' point of
 * view — and IDF makes sure the shared tokens are informative, not just
 * frequent.
 */
export function similarity(a: string[], b: string[], idf?: Map<string, number>): number {
  const setB = new Set(b);
  let shared = 0;
  for (const t of a) if (setB.has(t)) shared += w(t, idf);
  let wA = 0, wB = 0;
  for (const t of a) wA += w(t, idf);
  for (const t of b) wB += w(t, idf);
  return (wA + wB) > 0 ? (2 * shared) / (wA + wB) : 0;
}

export const MATCH_THRESHOLD = 0.55;

export function isMatch(a: string[], b: string[], idf?: Map<string, number>): boolean {
  // Short headlines are the main source of false merges: "Introducing Claude
  // Opus 5" reduces to {claude, opus}, so matching on two tokens lets a launch
  // absorb every story that merely names the model. Refuse to cluster on that
  // little evidence — a missed merge is recoverable, a false CONFIRMED is not.
  if (Math.min(a.length, b.length) < 3) return false;
  if (sharedCount(a, b) < 2) return false;
  return similarity(a, b, idf) >= MATCH_THRESHOLD;
}

// ---------------- clustering ----------------

export type Seed = { clusterId: string; tokens: string[] };

/**
 * Greedy incremental clustering with an inverted-token index for blocking.
 * Existing clusters keep their seed token set so assignments stay stable
 * across runs (a story never changes cluster once placed).
 */
export class Clusterer {
  private seeds = new Map<string, string[]>();
  private index = new Map<string, Set<string>>();
  private idf?: Map<string, number>;

  constructor(idf?: Map<string, number>) { this.idf = idf; }

  addSeed(clusterId: string, tokens: string[]) {
    if (this.seeds.has(clusterId)) return;
    this.seeds.set(clusterId, tokens);
    for (const t of tokens) {
      let s = this.index.get(t);
      if (!s) { s = new Set(); this.index.set(t, s); }
      s.add(clusterId);
    }
  }

  /** Existing cluster id for these tokens, or null. Only compares candidates sharing a token. */
  find(tokens: string[]): string | null {
    const counts = new Map<string, number>();
    for (const t of tokens) {
      const posting = this.index.get(t);
      if (!posting) continue;
      for (const cid of posting) counts.set(cid, (counts.get(cid) || 0) + 1);
    }
    let best: string | null = null, bestScore = 0;
    for (const [cid, shared] of counts) {
      if (shared < 2) continue;
      const seed = this.seeds.get(cid)!;
      if (!isMatch(tokens, seed, this.idf)) continue;
      const score = similarity(tokens, seed, this.idf);
      if (score > bestScore) { bestScore = score; best = cid; }
    }
    return best;
  }

  /** Find-or-create. */
  assign(tokens: string[], newId: string): string {
    const hit = this.find(tokens);
    if (hit) return hit;
    this.addSeed(newId, tokens);
    return newId;
  }

  get size() { return this.seeds.size; }
}

// ---------------- topics & entities ----------------

export const TOPICS: Record<string, string[]> = {
  models: ["model", "gpt", "claude", "gemini", "llama", "release", "launch", "opus", "sonnet", "haiku",
    "deepseek", "qwen", "grok", "mistral", "frontier", "multimodal", "context window", "version"],
  agents: ["agent", "agentic", "tool use", "mcp", "autonomous", "workflow", "copilot", "assistant",
    "orchestrat", "cursor", "codex", "coding agent"],
  hardware: ["gpu", "chip", "nvidia", "tpu", "h100", "b200", "datacenter", "data center", "compute",
    "wafer", "fab", "semiconductor", "memory", "hbm", "cluster", "inference cost", "amd", "tsmc"],
  policy: ["regulation", "regulat", "law", "act", "ban", "lawsuit", "court", "senate", "congress", "eu ",
    "policy", "copyright", "export", "antitrust", "governance", "compliance", "ftc", "attorney"],
  // stems, not whole words: "acquir" catches acquire/acquiring/acquisition/acquires
  // company financing, as distinct from public-market moves
  funding: ["raise", "raising", "fundin", "valuat", "round", "ipo", "acquir", "merger", "buyout",
    "payday", "payout", "seed", "series a", "series b", "venture", "startup"],
  // public markets: the single largest slice of what used to fall through to "other"
  markets: ["stock", "shares", "nasdaq", "s&p", "index", "rally", "sell-off", "selloff", "plunge",
    "plunging", "surge", "bubble", "investor", "wall street", "analyst", "trillion", "market cap",
    "earnings", "revenue", "billion", "million", "\\bdemand\\b", "capex", "spending", "short seller"],
  energy: ["\\bpower\\b", "electricity", "grid", "emission", "pollution", "nuclear", "carbon", "energy",
    "water use", "cooling", "megawatt", "gigawatt", "climate", "renewable"],
  engineering: ["compiler", "kernel", "latency", "throughput", "quantiz", "serving", "primer",
    "tutorial", "how to build", "architecture", "\\bapi\\b", "\\bsdk\\b", "framework", "library",
    "debug", "deploy", "pipeline", "codebase", "refactor", "runtime", "cache"],
  product: ["\\bapps?\\b", "iphone", "android", "browser", "search", "chrome", "subscription", "pricing",
    "\\btier\\b", "wearable", "glasses", "device", "voice", "spoken", "speech", "interface", "feature"],
  media: ["deepfake", "synthetic", "generated image", "generated video", "\\bslop\\b", "misinformation",
    "\\bfake\\b", "artwork", "music", "\\bfilm\\b", "photo", "viral", "content farm"],
  jobs: ["\\bjobs?\\b", "hiring", "layoff", "workforce", "labor", "labour", "employee", "productivity",
    "career", "salary", "recruit", "white collar", "entry-level", "replace workers"],
  // AI applied to a specific sector — the largest remaining slice of "other".
  // Deliberately sector NOUNS only. Bare "industry" is excluded: almost every
  // headline says "the AI industry", so it would swallow the whole board.
  // Military/defence is also excluded on purpose, so those stay with policy.
  industry: ["health care", "healthcare", "medical", "\\bclinics?\\b", "clinical", "patient", "hospital",
    "diagnos", "\\bmri\\b", "radiolog", "drug discovery", "biotech", "pharma", "therap", "genomic",
    "auto industry", "automaker", "\\bvehicles?\\b", "self-driving", "manufactur", "factory",
    "supply chain", "logistics", "warehouse", "\\bdelivery\\b", "shipping", "airline", "aviation",
    "\\bretail\\b", "ecommerce", "e-commerce", "\\bbanks?\\b", "banking", "insurance", "fintech", "\\bfraud\\b",
    "agricultur", "farming", "mining", "mineral", "geoscience", "construction", "\\blaw firms?\\b",
    "real estate", "telecom", "\\bhotels?\\b", "\\btravel\\b"],
  research: ["arxiv", "paper", "benchmark", "sota", "study", "findings", "researcher", "proof",
    "theorem", "dataset", "evaluation", "experiment"],
  safety: ["safety", "alignment", "jailbreak", "misuse", "risk", "interpretability", "eval", "red team",
    "harm", "bias", "hallucinat", "deception", "existential", "security", "attack", "vulnerab"],
  opensource: ["open source", "open-source", "open weight", "open-weight", "weights", "apache", "mit license",
    "hugging face", "fine-tune", "finetune", "self-host", "local model", "gguf"],
};

// Keyword lists mix plain substrings with \b-anchored patterns (so "\bjobs?\b"
// doesn't fire on "jobsworth"), so each topic compiles to one alternation.
const TOPIC_RE: [string, RegExp][] = Object.entries(TOPICS).map(([k, kws]) => [
  k,
  new RegExp(kws.map((w) => (w.includes("\\b") ? w : w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("|"), "gi"),
]);

export function topicOf(title: string, source: string): string {
  if (source === "arxiv") return "research";
  let best = "other", bestScore = 0;
  for (const [topic, re] of TOPIC_RE) {
    const m = title.match(re);          // String.match ignores lastIndex on /g/
    const score = m ? m.length : 0;
    if (score > bestScore) { bestScore = score; best = topic; }
  }
  return bestScore > 0 ? best : "other";
}

export const LABS: Record<string, string[]> = {
  openai: ["openai", "chatgpt", "\\bgpt-?\\d", "\\bsora\\b", "\\bcodex\\b", "\\bo\\d\\b", "sam altman", "dall"],
  anthropic: ["anthropic", "claude", "\\bopus\\b", "\\bsonnet\\b", "\\bhaiku\\b", "dario amodei"],
  google: ["google", "deepmind", "gemini", "\\btpu", "alphabet", "demis"],
  meta: ["\\bmeta\\b", "\\bllama\\b", "zuckerberg", "\\bfair\\b"],
  nvidia: ["nvidia", "\\bcuda\\b", "jensen huang", "\\bh100\\b", "\\bb200\\b", "blackwell"],
  mistral: ["mistral"],
  xai: ["\\bxai\\b", "\\bgrok\\b"],
  deepseek: ["deepseek"],
  alibaba: ["alibaba", "\\bqwen\\b"],
  microsoft: ["microsoft", "copilot", "azure"],
  amazon: ["amazon", "\\baws\\b", "bedrock"],
  apple: ["apple", "\\bsiri\\b"],
};
const LAB_RE: [string, RegExp][] = Object.entries(LABS).map(([k, pats]) => [k, new RegExp(pats.join("|"), "i")]);

export function entitiesOf(title: string): string[] {
  const out: string[] = [];
  for (const [lab, re] of LAB_RE) if (re.test(title)) out.push(lab);
  return out;
}

// ---------------- scoring ----------------

export type ClusterInput = {
  outlets: string[];       // distinct publishers, wires already excluded
  titleVariants: number;   // distinct headline texts
  points: number;
  comments: number;
  velocity: number;        // points gained per hour
  ageHours: number;
  wireOnly: boolean;
};

/**
 * Corroboration is the heart of the product.
 *
 * A story carried by 6 outlets that each WROTE THEIR OWN HEADLINE is
 * confirmed news. The same press release pasted into 6 sites is one company
 * talking. Taking min(outlets, variants) collapses syndication to 1 while
 * leaving genuine multi-outlet coverage intact.
 */
export function corroboration(outlets: string[], titleVariants: number): number {
  // Key the outlets rather than trusting the caller to have deduped them:
  // this function decides what CONFIRMED means, so it does its own counting.
  const distinct = new Set(outlets.map(outletKey).filter(Boolean)).size;
  return Math.max(1, Math.min(distinct, titleVariants));
}

/** 0-100. Corroboration is a multiplier, not an addend — that's what makes it the spine. */
export function signalScore(c: ClusterInput): number {
  if (c.wireOnly) return 0;
  const corr = corroboration(c.outlets, c.titleVariants);
  const corrWeight = 1 + Math.log2(corr);                          // 1→1, 2→2, 4→3, 8→4
  const engagement = 1 + Math.log10(1 + c.points + 2 * c.comments);
  const freshness = 1 / Math.pow(c.ageHours + 2, 0.8);
  const momentum = 1 + Math.min(2, Math.max(0, c.velocity) / 40);
  return corrWeight * engagement * freshness * momentum * 22;
}

/**
 * Hype = how much press noise a story has relative to primary evidence.
 * All press and no lab post / paper / code means the media is spinning up
 * on an announcement nobody has verified.
 */
export function hypeRatio(pressCount: number, primaryCount: number): number {
  return pressCount / (primaryCount + 1);
}

export const PRESS_SOURCES = new Set([
  "googlenews", "techcrunch", "verge", "arstechnica", "venturebeat", "wired", "technologyreview",
  "zdnet", "engadget", "semafor", "theinformation", "theregister", "cnbc", "guardian", "bbc",
  "nytimes", "ieee", "thedecoder", "marktechpost", "synced", "axios", "fortune", "businessinsider", "gizmodo",
]);
export const PRIMARY_SOURCES = new Set([
  "arxiv", "openai", "anthropic", "deepmind", "googleresearch", "huggingface", "mistral", "cohere", "ollama",
  "googleblogai", "metaai", "awsml", "bair", "microsoftresearch", "stanfordhai",
]);

export function classifySources(sources: string[]) {
  let press = 0, primary = 0, community = 0;
  for (const s of sources) {
    if (PRIMARY_SOURCES.has(s)) primary++;
    else if (PRESS_SOURCES.has(s)) press++;
    else community++;
  }
  return { press, primary, community };
}

/**
 * Verdict shown on each row. This is the thing people screenshot.
 *
 * Calibrated against a live corpus of ~900 stories: three independent
 * newsrooms each writing their own headline about one event is a real
 * confirmation bar, and it is reachable with this source pool. Four was tried
 * first and produced zero CONFIRMED stories in a day — a label nothing ever
 * earns teaches the reader nothing.
 */
export const CONFIRMED_AT = 3;

export function verdict(corr: number, hype: number): "CONFIRMED" | "DEVELOPING" | "SINGLE SOURCE" | "WIRE" {
  if (corr >= CONFIRMED_AT) return "CONFIRMED";
  if (corr >= 2) return "DEVELOPING";
  return hype > 2 ? "WIRE" : "SINGLE SOURCE";
}
