-- ============================================================
-- SIGNAL / NOISE — 0002: semantic clustering + outlet scorecard
--
-- Everything here is additive and IF NOT EXISTS / OR REPLACE, so it is
-- safe to run against a database already created by 0001_init.sql.
--
-- Why this exists: lexical clustering (rarity-weighted Dice over stemmed
-- headline tokens) cannot merge two write-ups of the same event that share
-- only one content word. Embeddings close that gap. They run in a SEPARATE
-- worker — see the note at the bottom.
-- ============================================================

create extension if not exists vector;

-- ---------- 384-dim vectors from the edge runtime's built-in gte-small ----------
alter table public.ai_news
  add column if not exists embedding vector(384);

-- Generated, so the embed worker can ask PostgREST for "rows still missing a
-- vector" with a plain boolean filter instead of `embedding=is.null`, which
-- PostgREST will not accept on a vector column.
alter table public.ai_news
  add column if not exists has_embedding boolean generated always as (embedding is not null) stored;

create index if not exists ai_news_embedding_idx
  on public.ai_news using hnsw (embedding vector_cosine_ops);

-- The embed worker's hot query is "oldest unembedded row in the window".
-- A partial index keeps that from scanning the whole table once the backlog
-- is drained and almost every row has a vector.
create index if not exists ai_news_needs_embedding_idx
  on public.ai_news (published_at desc) where embedding is null;

-- ---------- candidate merges ----------
-- One representative per cluster: the FIRST item that landed in it, which is
-- the same row the lexical clusterer used as that cluster's seed. Comparing
-- seeds (not every pair of items) keeps this O(clusters^2) instead of
-- O(items^2), and cosine distance is what the HNSW index is built for.
create or replace function public.find_semantic_merges(
  thresh double precision default 0.90,
  win    interval         default '7 days'
)
returns table (keep_cluster text, drop_cluster text, sim double precision, keep_title text, drop_title text)
language sql stable as $$
  with reps as (
    select distinct on (cluster_id)
      cluster_id, title, embedding, published_at
    from public.ai_news
    where embedding is not null and cluster_id is not null
      and published_at > now() - win
    order by cluster_id, inserted_at asc
  )
  select
    case when a.published_at <= b.published_at then a.cluster_id else b.cluster_id end,
    case when a.published_at <= b.published_at then b.cluster_id else a.cluster_id end,
    (1 - (a.embedding <=> b.embedding))::float,
    case when a.published_at <= b.published_at then a.title else b.title end,
    case when a.published_at <= b.published_at then b.title else a.title end
  from reps a
  join reps b
    on a.cluster_id < b.cluster_id
   and (a.embedding <=> b.embedding) < (1 - thresh)
  order by 3 desc
$$;

-- ---------- apply them ----------
-- The EARLIER cluster always wins, so cluster ids stay stable: a story never
-- moves to a newer id and the front-end never sees a row change identity.
create or replace function public.apply_semantic_merges(
  thresh double precision default 0.90,
  win    interval         default '7 days'
)
returns integer
language plpgsql as $$
declare moved int := 0;
begin
  with m as (
    -- a cluster may match several; collapse each into a single winner
    select distinct on (drop_cluster) drop_cluster, keep_cluster
    from public.find_semantic_merges(thresh, win)
    where keep_cluster <> drop_cluster
    order by drop_cluster, sim desc
  ),
  upd as (
    update public.ai_news n
       set cluster_id = m.keep_cluster
      from m
     where n.cluster_id = m.drop_cluster
    returning 1
  )
  select count(*) into moved from upd;
  return moved;
end $$;

-- ---------- THE SCORECARD: which outlets actually break news ----------
-- For every story with 2+ independent outlets, the one that published first
-- gets the scoop and everybody else gets a lag measured in minutes. This is
-- the number no outlet publishes about itself.
--
-- Wire copy is excluded (is_wire = false): a press release hitting 30 sites
-- at the same second would otherwise hand a "scoop" to whichever mirror the
-- feed happened to surface first.
--
-- Hosting platforms are excluded too. Outlet resolution maps a link to its
-- registrable domain, which is right for a newsroom and wrong for a platform:
-- a Hacker News post pointing at a tweet resolves to "twitter.com", and on a
-- first-to-publish metric that domain will out-scoop Reuters forever without
-- ever having reported anything. These are venues, not publishers.
create or replace view public.outlet_scorecard with (security_invoker = true) as
with item as (
  select cluster_id, outlet, min(published_at) as first_pub
  from public.ai_news
  where outlet is not null and cluster_id is not null and is_wire = false
    and outlet not in (
      'twitter.com', 'x.com', 'medium.com', 'substack.com', 'github.com', 'gist.github.com',
      'youtube.com', 'reddit.com', 'ycombinator.com', 'linkedin.com', 'facebook.com',
      'tiktok.com', 'threads.net', 'bsky.app', 'mastodon.social', 'notion.site',
      'docs.google.com', 'drive.google.com', 'arxiv.org', 'huggingface.co'
    )
    and published_at > now() - interval '14 days'
  group by cluster_id, outlet
),
story as (
  select cluster_id, min(first_pub) as leader_pub, count(*) as outlet_n
  from item group by cluster_id
)
select
  i.outlet,
  count(*)::int                                                       as stories,
  count(*) filter (where s.outlet_n >= 2)::int                        as covered_stories,
  count(*) filter (where s.outlet_n >= 2 and i.first_pub = s.leader_pub)::int as scoops,
  round(100.0 * count(*) filter (where s.outlet_n >= 2 and i.first_pub = s.leader_pub)
        / nullif(count(*) filter (where s.outlet_n >= 2), 0), 1)::float       as scoop_rate,
  round(avg(extract(epoch from i.first_pub - s.leader_pub) / 60.0)
        filter (where s.outlet_n >= 2), 1)::float                     as avg_lag_min,
  round(100.0 * count(*) filter (where s.outlet_n >= 2) / count(*), 1)::float as pickup_rate
from item i
join story s using (cluster_id)
group by i.outlet
having count(*) >= 3;      -- below this the rates are noise

-- ============================================================
-- Schedule the embed worker.
--
-- It runs on its OWN cron, offset by 2 minutes from the ingest job, because
-- running model inference in the same invocation as 47 feed fetches blows the
-- edge worker's compute budget (WORKER_RESOURCE_LIMIT). Even a batch of 48 at
-- concurrency 3 failed; the shipped worker does 10 serially and drains the
-- backlog across runs.
--
-- Replace <PROJECT_REF> and <ANON_KEY> before running.
-- ============================================================
-- select cron.schedule('signal-noise-embed-5min', '2-59/5 * * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/signal-noise-embed',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <ANON_KEY>',
--       'Content-Type', 'application/json'),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 150000);
-- $$);
