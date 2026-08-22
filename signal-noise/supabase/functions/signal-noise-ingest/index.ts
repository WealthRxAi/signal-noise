// ============================================================
// SIGNAL / NOISE — ingest + scoring worker (Supabase Edge Function)
//
// Every 5 minutes: pull ~47 feeds, drop off-topic noise, resolve the real
// publisher behind each link, cluster near-duplicate headlines into stories,
// score each story by INDEPENDENT CORROBORATION, and write both the item
// table and the story table.
//
// A dead feed logs an error in the run stats and never aborts the run.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as L from "./lib.ts";

const UA = "signal-noise-bot/1.0 (+https://github.com/; open-source AI news terminal)";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDDIT_ID = Deno.env.get("REDDIT_CLIENT_ID") || "";
const REDDIT_SECRET = Deno.env.get("REDDIT_CLIENT_SECRET") || "";

const RETENTION_MS = 14 * 24 * 3600 * 1000;
// Deliberately equal to retention: every run rebuilds every story in the
// window, which lets us delete any story row the rebuild didn't touch.
const CLUSTER_WINDOW_MS = RETENTION_MS;
// Feeds are fetched in waves rather than all at once: 47 simultaneous
// downloads (several with 1000+ item bodies) pushed peak memory over the
// worker limit.
const FETCH_WAVE = 10;

type Src = { label: string; source: string; kind: "hn" | "reddit" | "rss"; url: string; sub?: string; delayMs?: number };

const SOURCES: Src[] = [
  // ---- community (engagement signal) ----
  ...["AI", "LLM", "OpenAI", "Anthropic", "GPT", "Gemini", "machine learning"].map((q): Src => ({
    label: "hn:" + q, source: "hackernews", kind: "hn",
    url: "https://hn.algolia.com/api/v1/search_by_date?query=" + encodeURIComponent(q) + "&tags=story&hitsPerPage=40",
  })),
  ...["LocalLLaMA", "MachineLearning", "singularity", "artificial"].map((s): Src => ({
    label: "reddit:" + s, source: "reddit", kind: "reddit", sub: s,
    url: "https://www.reddit.com/r/" + s + "/new.json?limit=25",
  })),

  // ---- independent press (this is what makes corroboration possible) ----
  { label: "techcrunch", source: "techcrunch", kind: "rss", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { label: "verge", source: "verge", kind: "rss", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { label: "arstechnica", source: "arstechnica", kind: "rss", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
  { label: "venturebeat", source: "venturebeat", kind: "rss", url: "https://venturebeat.com/category/ai/feed/" },
  { label: "wired", source: "wired", kind: "rss", url: "https://www.wired.com/feed/tag/ai/latest/rss" },
  { label: "technologyreview", source: "technologyreview", kind: "rss", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed" },
  { label: "zdnet", source: "zdnet", kind: "rss", url: "https://www.zdnet.com/topic/artificial-intelligence/rss.xml" },
  { label: "googlenews", source: "googlenews", kind: "rss",
    url: "https://news.google.com/rss/search?q=artificial+intelligence+when:1d&hl=en-US&gl=US&ceid=US:en" },

  // ---- analysis / newsletters ----
  { label: "platformer", source: "platformer", kind: "rss", url: "https://www.platformer.news/rss/" },
  { label: "importai", source: "importai", kind: "rss", url: "https://importai.substack.com/feed" },
  { label: "semianalysis", source: "semianalysis", kind: "rss", url: "https://www.semianalysis.com/feed" },
  { label: "simonwillison", source: "simonwillison", kind: "rss", url: "https://simonwillison.net/atom/everything/" },

  // ---- primary sources (labs + papers) ----
  ...["cs.AI", "cs.CL", "cs.LG"].map((c): Src => ({
    label: "arxiv:" + c, source: "arxiv", kind: "rss", delayMs: 3000,
    url: "https://export.arxiv.org/api/query?search_query=cat:" + c + "&sortBy=submittedDate&sortOrder=descending&max_results=25",
  })),
  { label: "openai", source: "openai", kind: "rss", url: "https://openai.com/news/rss.xml" },
  { label: "googleresearch", source: "googleresearch", kind: "rss", url: "https://research.google/blog/rss/" },
  { label: "deepmind", source: "deepmind", kind: "rss", url: "https://deepmind.google/blog/rss.xml" },
  { label: "huggingface", source: "huggingface", kind: "rss", url: "https://huggingface.co/blog/feed.xml" },
  { label: "anthropic:news", source: "anthropic", kind: "rss",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml" },
  { label: "anthropic:eng", source: "anthropic", kind: "rss",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml" },
  { label: "mistral", source: "mistral", kind: "rss",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_mistral.xml" },
  { label: "cohere", source: "cohere", kind: "rss",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cohere.xml" },
  { label: "ollama", source: "ollama", kind: "rss",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_ollama.xml" },

  // ---- wider press pool (added to raise how often a story clears the bar) ----
  { label: "theregister", source: "theregister", kind: "rss", url: "https://www.theregister.com/software/ai_ml/headlines.atom" },
  { label: "engadget", source: "engadget", kind: "rss", url: "https://www.engadget.com/rss.xml" },
  { label: "cnbc", source: "cnbc", kind: "rss", url: "https://www.cnbc.com/id/19854910/device/rss/rss.html" },
  { label: "guardian", source: "guardian", kind: "rss", url: "https://www.theguardian.com/technology/artificialintelligenceai/rss" },
  { label: "bbc", source: "bbc", kind: "rss", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { label: "nytimes", source: "nytimes", kind: "rss", url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml" },
  { label: "ieee", source: "ieee", kind: "rss", url: "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss" },
  { label: "thedecoder", source: "thedecoder", kind: "rss", url: "https://the-decoder.com/feed/" },
  { label: "marktechpost", source: "marktechpost", kind: "rss", url: "https://www.marktechpost.com/feed/" },
  { label: "synced", source: "synced", kind: "rss", url: "https://syncedreview.com/feed/" },
  { label: "axios", source: "axios", kind: "rss", url: "https://api.axios.com/feed/technology" },
  { label: "fortune", source: "fortune", kind: "rss", url: "https://fortune.com/section/ai/feed/" },
  { label: "businessinsider", source: "businessinsider", kind: "rss", url: "https://www.businessinsider.com/sai/rss" },
  { label: "gizmodo", source: "gizmodo", kind: "rss", url: "https://gizmodo.com/feed" },

  // ---- independent analysis ----
  { label: "interconnects", source: "interconnects", kind: "rss", url: "https://www.interconnects.ai/feed" },
  { label: "oneusefulthing", source: "oneusefulthing", kind: "rss", url: "https://www.oneusefulthing.org/feed" },
  { label: "aisnakeoil", source: "aisnakeoil", kind: "rss", url: "https://www.aisnakeoil.com/feed" },
  { label: "lastweekinai", source: "lastweekinai", kind: "rss", url: "https://lastweekin.ai/feed" },
  { label: "thezvi", source: "thezvi", kind: "rss", url: "https://thezvi.substack.com/feed" },

  // ---- more primary labs ----
  { label: "googleblogai", source: "googleblogai", kind: "rss", url: "https://blog.google/technology/ai/rss/" },
  { label: "metaai", source: "metaai", kind: "rss", url: "https://ai.meta.com/blog/rss/" },
  { label: "awsml", source: "awsml", kind: "rss", url: "https://aws.amazon.com/blogs/machine-learning/feed/" },
  { label: "bair", source: "bair", kind: "rss", url: "https://bair.berkeley.edu/blog/feed.xml" },
  { label: "microsoftresearch", source: "microsoftresearch", kind: "rss", url: "https://www.microsoft.com/en-us/research/feed/" },
  { label: "stanfordhai", source: "stanfordhai", kind: "rss", url: "https://hai.stanford.edu/news/rss.xml" },
];

// ---------------- canonical id ----------------
function canonicalUrl(rawUrl: unknown): string | null {
  if (!rawUrl) return null;
  let u: URL;
  try { u = new URL(String(rawUrl).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  const kill: string[] = [];
  u.searchParams.forEach((_v, k) => {
    const kl = k.toLowerCase();
    if (kl.startsWith("utm_") || ["ref", "ref_src", "source", "fbclid", "gclid", "mc_cid", "mc_eid", "cmpid", "ncid", "oc"].includes(kl)) kill.push(k);
  });
  kill.forEach((k) => u.searchParams.delete(k));
  u.searchParams.sort();
  return u.toString().replace(/\/+$/, "").replace(/\?$/, "");
}

function fnv1a64(str: string): string {
  let h = 0xcbf29ce484222325n;
  const p = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) { h ^= BigInt(str.charCodeAt(i)); h = (h * p) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, "0");
}
const makeId = (url: unknown) => { const c = canonicalUrl(url); return c ? fnv1a64(c) : null; };

// ---------------- feed parsing ----------------
type Raw = { source: string; title: string; url: string; published_at: string | null; points: number; comments: number; has_engagement: boolean; raw: Record<string, unknown> };

// deno-lint-ignore no-explicit-any
function normHackerNews(json: any): Raw[] {
  return (json.hits || []).map((h: any) => ({
    source: "hackernews",
    title: h.title || "",
    url: h.url || ("https://news.ycombinator.com/item?id=" + h.objectID),
    published_at: h.created_at,
    points: h.points || 0, comments: h.num_comments || 0,
    has_engagement: true,
    raw: { objectID: h.objectID, author: h.author, hn: "https://news.ycombinator.com/item?id=" + h.objectID },
  }));
}

// deno-lint-ignore no-explicit-any
function normReddit(json: any, sub?: string): Raw[] {
  return ((json.data && json.data.children) || []).map((c: any) => {
    const d = c.data || {};
    return {
      source: "reddit",
      title: d.title || "",
      url: (!d.is_self && d.url) ? d.url : ("https://www.reddit.com" + (d.permalink || "")),
      published_at: new Date((d.created_utc || 0) * 1000).toISOString(),
      points: d.ups || 0, comments: d.num_comments || 0,
      has_engagement: true,
      raw: { subreddit: d.subreddit || sub, permalink: d.permalink },
    };
  });
}

function xmlText(block: string, tag: string): string | null {
  const m = block.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
  if (!m) return null;
  let t = m[1].trim();
  const cd = t.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cd) t = cd[1].trim();
  return t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "").trim();
}
function xmlAttr(block: string, tag: string, attr: string): string | null {
  const m = block.match(new RegExp("<" + tag + "\\s[^>]*" + attr + '="([^"]*)"', "i"));
  return m ? m[1] : null;
}

function normRss(xml: string, source: string): Raw[] {
  const out: Raw[] = [];
  const itemRe = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const b = m[2];
    const title = xmlText(b, "title");
    let link = xmlText(b, "link");
    if (!link) {
      const alt = b.match(/<link\s[^>]*rel="alternate"[^>]*href="([^"]*)"/i);
      link = alt ? alt[1] : xmlAttr(b, "link", "href");
    }
    if (!link) { const id = xmlText(b, "id"); if (id && /^https?:\/\//.test(id)) link = id; }
    const date = xmlText(b, "pubDate") || xmlText(b, "published") || xmlText(b, "updated") || xmlText(b, "dc:date");
    const t = Date.parse(date || "");
    if (title && link && !isNaN(t)) {
      out.push({
        source, title, url: link, published_at: new Date(t).toISOString(),
        points: 0, comments: 0, has_engagement: false, raw: {},
      });
    }
  }
  return out;
}

// ---------------- http ----------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


async function fetchOnce(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers, redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(to); }
}

async function fetchText(url: string, timeoutMs = 20000, headers: Record<string, string> = { "User-Agent": UA, "Accept": "*/*" }): Promise<string> {
  try { return await fetchOnce(url, headers, timeoutMs); }
  catch (e) {
    const msg = String((e as Error).message || e);
    if (/HTTP 5\d\d|abort|network/i.test(msg)) { await sleep(2000); return await fetchOnce(url, headers, timeoutMs); }
    throw e;
  }
}

let redditToken: string | null | undefined;
async function getRedditToken(): Promise<string | null> {
  if (redditToken !== undefined) return redditToken;
  if (!REDDIT_ID || !REDDIT_SECRET) { redditToken = null; return null; }
  try {
    const r = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(REDDIT_ID + ":" + REDDIT_SECRET),
        "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA,
      },
      body: "grant_type=client_credentials",
    });
    if (!r.ok) throw new Error("token HTTP " + r.status);
    redditToken = (await r.json()).access_token || null;
  } catch { redditToken = null; }
  return redditToken;
}

async function fetchReddit(sub: string): Promise<string> {
  const token = await getRedditToken();
  if (token) {
    return await fetchText("https://oauth.reddit.com/r/" + sub + "/new?limit=25", 20000,
      { Authorization: "Bearer " + token, "User-Agent": UA, "Accept": "application/json" });
  }
  return await fetchText("https://www.reddit.com/r/" + sub + "/new.json?limit=25");
}

// ---------------- supabase ----------------
const sbHeaders = {
  apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json",
};

async function sbSelect(path: string): Promise<any[]> {
  const rows: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=${PAGE}&offset=${offset}`, { headers: sbHeaders });
    if (!r.ok) throw new Error("select " + r.status + " " + (await r.text()).slice(0, 200));
    const page = await r.json();
    rows.push(...page);
    if (page.length < PAGE) break;
    if (offset > 20000) break; // hard stop
  }
  return rows;
}

async function sbUpsert(table: string, rows: unknown[], chunk = 400): Promise<string> {
  if (!rows.length) return "ok";
  // PostgREST rejects a bulk payload whose objects have differing key sets
  // ("PGRST102 All object keys must match"). The self-heal and ingest paths
  // build slightly different shapes, so normalise to the union of keys.
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r as object)))];
  rows = rows.map((r) => {
    // deno-lint-ignore no-explicit-any
    const src = r as any, o: Record<string, unknown> = {};
    for (const k of keys) o[k] = src[k] === undefined ? null : src[k];
    return o;
  });
  for (let i = 0; i < rows.length; i += chunk) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + chunk)),
    });
    if (!r.ok) return "FAILED HTTP " + r.status + " " + (await r.text()).slice(0, 200);
  }
  return "ok";
}

// ---------------- stock quotes ----------------
const SYMBOLS = ["NVDA", "MSFT", "GOOGL", "META", "AMZN", "TSM"];

async function fetchQuoteYahoo(sym: string) {
  const body = await fetchText("https://query1.finance.yahoo.com/v8/finance/chart/" + sym + "?range=1d&interval=1d",
    15000, { "User-Agent": UA, "Accept": "application/json" });
  const meta = JSON.parse(body)?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice, prev = meta?.chartPreviousClose ?? meta?.previousClose;
  if (typeof price !== "number" || typeof prev !== "number" || !prev) throw new Error("yahoo shape");
  return { symbol: sym, price, prev_close: prev, change_pct: ((price - prev) / prev) * 100 };
}

async function fetchQuoteStooq(sym: string) {
  const body = await fetchText("https://stooq.com/q/l/?s=" + sym.toLowerCase() + ".us&f=sd2t2ohlcv&h&e=csv", 15000);
  const line = body.trim().split("\n")[1];
  if (!line) throw new Error("stooq empty");
  const p = line.split(",");
  const open = parseFloat(p[3]), close = parseFloat(p[6]);
  if (!isFinite(close) || !isFinite(open) || !open) throw new Error("stooq shape");
  return { symbol: sym, price: close, prev_close: open, change_pct: ((close - open) / open) * 100 };
}

async function updateQuotes(stats: Record<string, number | string>) {
  const quotes: any[] = [];
  await Promise.all(SYMBOLS.map(async (sym) => {
    try {
      let q; try { q = await fetchQuoteYahoo(sym); } catch { q = await fetchQuoteStooq(sym); }
      quotes.push({ ...q, change_pct: Math.round(q.change_pct * 100) / 100, updated_at: new Date().toISOString() });
    } catch (e) { stats["quote:" + sym] = "ERROR: " + String((e as Error).message || e).slice(0, 80); }
  }));
  stats["quotes"] = quotes.length ? await sbUpsert("ai_quotes", quotes) === "ok" ? quotes.length : "ERROR: upsert"
    : "ERROR: all symbols failed";
}

// ---------------- main ----------------
async function run() {
  const NOW = Date.now();
  const stats: Record<string, number | string> = {};
  const fetched: Raw[] = [];

  // ---- 1. pull every feed, isolated ----
  const handle = async (src: Src) => {
    try {
      const body = src.kind === "reddit" ? await fetchReddit(src.sub!) : await fetchText(src.url);
      const items = src.kind === "hn" ? normHackerNews(JSON.parse(body))
        : src.kind === "reddit" ? normReddit(JSON.parse(body), src.sub)
        : normRss(body, src.source);
      stats[src.label] = items.length;
      fetched.push(...items);
    } catch (e) {
      stats[src.label] = "ERROR: " + String((e as Error).message || e).slice(0, 120);
    }
  };
  await updateQuotes(stats);
  const parallel = SOURCES.filter((s) => !s.delayMs);
  for (let i = 0; i < parallel.length; i += FETCH_WAVE) {
    await Promise.all(parallel.slice(i, i + FETCH_WAVE).map(handle));
  }
  for (const src of SOURCES.filter((s) => s.delayMs)) { await sleep(src.delayMs!); await handle(src); }

  // ---- 2. clean, filter, enrich ----
  let dropped_offtopic = 0, dropped_stale = 0, dropped_bad = 0, dropped_filler = 0;
  const byId = new Map<string, any>();
  for (const it of fetched) {
    const title = L.cleanTitle(it.title, it.source);
    const id = makeId(it.url);
    const t = it.published_at ? Date.parse(it.published_at) : NaN;
    if (!id || !title || isNaN(t)) { dropped_bad++; continue; }
    if (t > NOW + 6 * 3600e3 || t < NOW - RETENTION_MS) { dropped_stale++; continue; }
    if (!L.isAiRelevant(title, it.source)) { dropped_offtopic++; continue; }
    if (L.isFiller(title, it.source)) { dropped_filler++; continue; }

    const outlet = L.outletOf(it.url, it.source, it.title);
    const prev = byId.get(id);
    const row = {
      id, source: it.source, title, url: it.url,
      published_at: new Date(t).toISOString(),
      points: it.points | 0, comments: it.comments | 0,
      outlet, is_wire: L.isWire(outlet),
      topic: L.topicOf(title, it.source),
      entities: L.entitiesOf(title),
      raw: it.raw || {},
    };
    // same URL from two feeds: keep the higher-engagement copy
    if (!prev || (row.points + row.comments) > (prev.points + prev.comments)) byId.set(id, row);
  }
  const incoming = [...byId.values()];
  const fetchedCount = fetched.length;
  fetched.length = 0;   // release raw feed bodies before the big load

  // ---- 3. load the clustering window ----
  const since = new Date(NOW - CLUSTER_WINDOW_MS).toISOString();
  let existing: any[] = [];
  try {
    existing = await sbSelect("ai_news?select=id,source,title,url,outlet,is_wire,topic,entities,points,comments,raw," +
      "points_prev,points_prev_at,velocity,cluster_id,published_at,inserted_at" +
      `&published_at=gte.${since}&order=inserted_at.asc`);
  } catch (e) { stats["load_existing"] = "ERROR: " + String((e as Error).message).slice(0, 120); }
  stats["existing_rows"] = existing.length;

  // Rows written before a heuristic existed (or before a column did) would
  // otherwise aggregate as nulls forever — an item with no outlet silently
  // contributes nothing to corroboration. Re-derive on read, and drop anything
  // the current relevance filter would reject so old noise leaves the board.
  const beforeFilter = existing.length;
  existing = existing
    .map((r) => {
      const outlet = r.outlet || L.outletOf(r.url, r.source, r.title);
      return {
        ...r,
        outlet,
        is_wire: r.is_wire ?? L.isWire(outlet),
        topic: L.topicOf(r.title, r.source),
        entities: (r.entities && r.entities.length) ? r.entities : L.entitiesOf(r.title),
      };
    })
    .filter((r) => L.isAiRelevant(r.title, r.source) && !L.isFiller(r.title, r.source));
  stats["existing_filtered_out"] = beforeFilter - existing.length;

  // ---- 4. seed the clusterer from what we already know ----
  // IDF is built over the whole live corpus so common AI vocabulary
  // ("model", "openai") counts for little and distinctive nouns carry the match
  const idf = L.buildIdf([...existing.map((r) => r.title), ...incoming.map((r) => r.title)]);
  const clusterer = new L.Clusterer(idf);
  const seenCluster = new Set<string>();
  for (const r of existing) {                      // ordered oldest-first: first member seeds its cluster
    if (!r.cluster_id || seenCluster.has(r.cluster_id)) continue;
    seenCluster.add(r.cluster_id);
    clusterer.addSeed(r.cluster_id, L.tokenize(r.title));
  }
  const clustersBefore = clusterer.size;

  const existingById = new Map(existing.map((r) => [r.id, r]));

  // ---- 5. assign clusters + compute velocity ----
  const toWrite: any[] = [];

  // Self-heal: a row can lack a cluster because the column was just added, or
  // because clusters were reset after a scoring change. Without this, those
  // rows each become their own single-item "story" forever, since cluster ids
  // are sticky once written. Oldest first so the earliest item seeds.
  let rehomed = 0;
  for (const r of existing) {
    if (r.cluster_id) continue;
    r.cluster_id = clusterer.assign(L.tokenize(r.title), r.id);
    rehomed++;
    toWrite.push({
      id: r.id, source: r.source, title: r.title, url: r.url,
      published_at: r.published_at, points: r.points | 0, comments: r.comments | 0,
      outlet: r.outlet, is_wire: r.is_wire, topic: r.topic, entities: r.entities,
      cluster_id: r.cluster_id, velocity: r.velocity ?? 0, raw: r.raw ?? {},
      points_prev: r.points_prev ?? r.points, points_prev_at: r.points_prev_at,
    });
  }
  stats["rehomed"] = rehomed;

  for (const row of incoming) {
    const ex = existingById.get(row.id);
    const cluster_id = ex?.cluster_id || clusterer.assign(L.tokenize(row.title), row.id);

    let points_prev = row.points, points_prev_at = new Date(NOW).toISOString(), velocity = 0;
    if (ex) {
      const prevAt = ex.points_prev_at ? Date.parse(ex.points_prev_at) : null;
      const hrs = prevAt ? (NOW - prevAt) / 3600e3 : 0;
      if (prevAt && hrs >= 0.25) velocity = (row.points - (ex.points_prev ?? row.points)) / hrs;
      else velocity = ex.velocity ?? 0;
      if (prevAt && hrs <= 1) { points_prev = ex.points_prev ?? row.points; points_prev_at = ex.points_prev_at; }
    }
    toWrite.push({ ...row, cluster_id, points_prev, points_prev_at, velocity: Math.round(velocity * 100) / 100 });
  }
  stats["new_clusters"] = clusterer.size - clustersBefore;

  const upsertItems = toWrite.length ? await sbUpsert("ai_news", toWrite) : "skipped (0 rows)";


  // ---- 6. rebuild the story table from the full window ----
  const merged = new Map<string, any>();
  for (const r of existing) merged.set(r.id, r);
  for (const r of toWrite) merged.set(r.id, r);          // fresh values win

  const groups = new Map<string, any[]>();
  for (const r of merged.values()) {
    const cid = r.cluster_id || r.id;
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid)!.push(r);
  }

  const stories: any[] = [];
  for (const [cluster_id, items] of groups) {
    const editorial = items.filter((i) => !i.is_wire);
    const wireOnly = editorial.length === 0;
    const pool = wireOnly ? items : editorial;

    // Deduped by outlet KEY, not by string: "cnbc" and "cnbc.com" are one
    // newsroom reached two ways, and counting them twice inflates the verdict.
    const outlets = L.dedupeOutlets(pool.map((i) => i.outlet));
    const variants = new Set(pool.map((i) => L.titleKey(i.title))).size;
    const corr = L.corroboration(outlets, variants);
    const sources = [...new Set(items.map((i) => i.source))];
    const { press, primary } = L.classifySources(sources);
    const hype = L.hypeRatio(press, primary);

    // headline: the most-engaged copy, preferring a real newsroom over a wire
    const lead = pool.slice().sort((a, b) =>
      (b.points + b.comments) - (a.points + a.comments) || Date.parse(b.published_at) - Date.parse(a.published_at))[0];

    const points = items.reduce((s, i) => s + (i.points || 0), 0);
    const comments = items.reduce((s, i) => s + (i.comments || 0), 0);
    const velocity = items.reduce((s, i) => s + Math.max(0, i.velocity || 0), 0);
    const published = Math.max(...items.map((i) => Date.parse(i.published_at)));
    const firstSeen = Math.min(...items.map((i) => Date.parse(i.inserted_at || i.published_at)));
    const ageHours = Math.max(0, (NOW - published) / 3600e3);

    const signal = L.signalScore({ outlets, titleVariants: variants, points, comments, velocity, ageHours, wireOnly });
    const entities = [...new Set(items.flatMap((i) => i.entities || []))];
    const topicCounts = new Map<string, number>();
    for (const i of items) topicCounts.set(i.topic || "other", (topicCounts.get(i.topic || "other") || 0) + 1);
    const topic = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    stories.push({
      cluster_id,
      title: lead.title, url: lead.url, outlet: lead.outlet,
      sources, outlets,
      corroboration: corr, variants,
      verdict: wireOnly ? "WIRE" : L.verdict(corr, hype),
      signal: Math.round(signal * 100) / 100,
      hype: Math.round(hype * 100) / 100,
      points, comments, velocity: Math.round(velocity * 100) / 100,
      topic, entities,
      item_count: items.length, press_count: press, primary_count: primary,
      first_seen: new Date(firstSeen).toISOString(),
      published_at: new Date(published).toISOString(),
      updated_at: new Date(NOW).toISOString(),
    });
  }

  const upsertStories = stories.length ? await sbUpsert("signal_stories", stories) : "skipped (0 rows)";

  // ---- 7. prune ----
  const cutoff = new Date(NOW - RETENTION_MS).toISOString();
  const pruneA = await fetch(`${SUPABASE_URL}/rest/v1/ai_news?published_at=lt.${encodeURIComponent(cutoff)}`,
    { method: "DELETE", headers: { ...sbHeaders, Prefer: "return=minimal" } });
  // Every live story was just rewritten with updated_at = NOW, so anything
  // older is a story whose items aged out or got filtered — drop it, otherwise
  // retired noise lingers on the board for the full retention period.
  const staleBefore = new Date(NOW - 60000).toISOString();
  const pruneB = await fetch(`${SUPABASE_URL}/rest/v1/signal_stories?updated_at=lt.${encodeURIComponent(staleBefore)}`,
    { method: "DELETE", headers: { ...sbHeaders, Prefer: "return=minimal" } });

  const confirmed = stories.filter((s) => s.verdict === "CONFIRMED").length;
  const summary = {
    run_at: new Date(NOW).toISOString(),
    fetched: fetchedCount,
    kept: incoming.length,
    dropped_offtopic, dropped_stale, dropped_bad, dropped_filler,
    items_upserted: toWrite.length,
    stories: stories.length,
    confirmed,
    upsert_items: upsertItems, upsert_stories: upsertStories,
    prune: (pruneA.ok && pruneB.ok) ? "ok" : `items:${pruneA.status} stories:${pruneB.status}`,
    stats,
  };
  console.log("[signal-noise]", JSON.stringify(summary));
  return summary;
}

Deno.serve(async (_req: Request) => {
  try {
    return new Response(JSON.stringify(await run()), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[signal-noise] FATAL", e);
    return new Response(JSON.stringify({ error: String(e), stack: (e as Error).stack }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
