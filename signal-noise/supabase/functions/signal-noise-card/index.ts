// ============================================================
// SIGNAL / NOISE — share card
//
// Renders the current CONFIRMED stories as an SVG sized for a social
// preview (1200x630). Every time somebody pastes the link, the card is
// a live snapshot of the board rather than a static logo.
//
// Public on purpose (verify_jwt=false): social crawlers cannot send auth
// headers. It only ever reads data that is already public via RLS.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Rough width-aware truncation for the card's font size. */
function fit(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

function ago(iso: string) {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return Math.floor(m) + "m";
  if (m < 1440) return Math.floor(m / 60) + "h";
  return Math.floor(m / 1440) + "d";
}

Deno.serve(async () => {
  let rows: Array<Record<string, unknown>> = [];
  let counts = { confirmed: 0, developing: 0, total: 0 };
  try {
    const headers = { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY };
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/signal_stories?select=title,outlets,corroboration,verdict,published_at` +
      `&published_at=gte.${since}&order=corroboration.desc,signal.desc&limit=40`, { headers });
    if (r.ok) {
      const all = await r.json();
      counts.total = all.length;
      counts.confirmed = all.filter((s: any) => s.verdict === "CONFIRMED").length;
      counts.developing = all.filter((s: any) => s.verdict === "DEVELOPING").length;
      rows = all.filter((s: any) => s.corroboration >= 2).slice(0, 5);
      if (rows.length < 3) rows = all.slice(0, 5);
    }
  } catch { /* fall through to an empty card rather than erroring the crawler */ }

  const W = 1200, H = 630;
  const items = rows.map((s: any, i: number) => {
    const y = 216 + i * 74;
    const conf = s.verdict === "CONFIRMED";
    const chip = conf ? "#199e70" : s.verdict === "DEVELOPING" ? "#c98500" : "#5d5c54";
    const pips = Array.from({ length: 5 }, (_, k) =>
      `<circle cx="${150 + k * 15}" cy="${y + 30}" r="5" fill="${k < Math.min(s.corroboration, 5) ? chip : "#3a3a36"}"/>`).join("");
    const outlets = fit((s.outlets || []).slice(0, 3).join("  ·  "), 52);
    return `
      <rect x="56" y="${y}" width="1088" height="62" rx="6" fill="#171716"/>
      <rect x="56" y="${y}" width="4" height="62" fill="${chip}"/>
      <text x="84" y="${y + 26}" font-family="monospace" font-size="15" font-weight="700" fill="${chip}">x${s.corroboration}</text>
      ${pips}
      <text x="246" y="${y + 27}" font-family="Helvetica,Arial,sans-serif" font-size="23" font-weight="600" fill="#ffffff">${esc(fit(s.title, 62))}</text>
      <text x="246" y="${y + 50}" font-family="monospace" font-size="14" fill="#8a897f">${esc(outlets)}</text>
      <text x="1120" y="${y + 38}" text-anchor="end" font-family="monospace" font-size="14" fill="#5d5c54">${ago(s.published_at)}</text>`;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0e0e0d"/>
  <text x="56" y="84" font-family="monospace" font-size="40" font-weight="800" fill="#ffffff" letter-spacing="3">SIGNAL<tspan fill="#5d5c54">/</tspan><tspan fill="#3987e5">NOISE</tspan></text>
  <text x="56" y="124" font-family="Helvetica,Arial,sans-serif" font-size="22" fill="#c3c2b7">Which AI stories are actually confirmed — ranked by independent corroboration.</text>
  <line x1="56" y1="152" x2="1144" y2="152" stroke="#2b2b28" stroke-width="1"/>
  <text x="56" y="186" font-family="monospace" font-size="17" fill="#8a897f">LAST 24H</text>
  <text x="180" y="186" font-family="monospace" font-size="17" font-weight="700" fill="#199e70">${counts.confirmed} CONFIRMED</text>
  <text x="370" y="186" font-family="monospace" font-size="17" font-weight="700" fill="#c98500">${counts.developing} DEVELOPING</text>
  <text x="580" y="186" font-family="monospace" font-size="17" fill="#5d5c54">${counts.total} STORIES TRACKED</text>
  ${items}
  <text x="56" y="600" font-family="monospace" font-size="15" fill="#5d5c54">Dots = independent outlets that each wrote their own headline. Syndicated press releases score 1.</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
