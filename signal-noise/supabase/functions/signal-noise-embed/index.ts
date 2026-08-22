// ============================================================
// SIGNAL / NOISE — embedding + semantic merge worker
//
// Split out of the ingest worker deliberately: model inference inside the
// same invocation as 47 feed fetches exceeded the compute budget. A batch
// of 48 at concurrency 3 still did — gte-small's memory footprint dominates,
// so this runs a small serial batch and drains the backlog across runs.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sbHeaders = {
  apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json",
};

const BATCH = 10;              // small and serial: the model, not the I/O, is the constraint
const SEMANTIC_THRESHOLD = 0.90;

Deno.serve(async () => {
  const t0 = Date.now();
  // deno-lint-ignore no-explicit-any
  const out: Record<string, any> = {};
  try {
    const since = new Date(Date.now() - 14 * 24 * 3600e3).toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_news?select=id,title&has_embedding=is.false` +
      `&published_at=gte.${since}&order=published_at.desc&limit=${BATCH}`, { headers: sbHeaders });
    if (!r.ok) throw new Error("select " + r.status);
    const rows = await r.json();
    out.batch = rows.length;

    let done = 0, failed = 0;
    if (rows.length) {
      // @ts-ignore Supabase global, present in the edge runtime
      const session = new Supabase.ai.Session("gte-small");
      for (const row of rows) {
        try {
          const v = await session.run(row.title, { mean_pool: true, normalize: true });
          // PATCH one row: the payload is a single column, so an upsert would
          // need every NOT NULL field just to write a vector.
          const p = await fetch(`${SUPABASE_URL}/rest/v1/ai_news?id=eq.${encodeURIComponent(row.id)}`, {
            method: "PATCH",
            headers: { ...sbHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ embedding: JSON.stringify(Array.from(v as number[])) }),
          });
          if (p.ok) done++; else failed++;
        } catch { failed++; }
      }
    }
    out.embedded = done;
    if (failed) out.failed = failed;

    const c = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_news?select=id&has_embedding=is.false&published_at=gte.${since}&limit=1`,
      { headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0" } });
    out.remaining = c.headers.get("content-range")?.split("/")?.[1] ?? "?";

    // Merge clusters whose seed headlines are semantically the same story.
    // Runs every pass so merges appear as soon as both sides have vectors.
    const m = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_semantic_merges`, {
      method: "POST", headers: sbHeaders,
      body: JSON.stringify({ thresh: SEMANTIC_THRESHOLD, win: "7 days" }),
    });
    out.semantic_merged_items = m.ok ? await m.json() : "ERROR: HTTP " + m.status;

    out.ms = Date.now() - t0;
    console.log("[signal-noise-embed]", JSON.stringify(out));
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    out.error = String(e);
    return new Response(JSON.stringify(out), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
