-- ============================================================
-- SIGNAL / NOISE — complete schema
-- Run once against a fresh Supabase project (SQL editor, or
-- `supabase db push`). Safe to re-run: everything is IF NOT EXISTS.
-- ============================================================

-- ---------- items: one row per URL we have ever seen ----------
create table if not exists public.ai_news (
  id             text primary key,          -- hash of the canonical URL
  source         text not null,             -- the FEED it arrived on
  title          text not null,
  url            text not null,
  published_at   timestamptz not null,
  points         int  default 0,
  comments       int  default 0,
  score          double precision default 0,
  raw            jsonb,
  inserted_at    timestamptz default now(),

  cluster_id     text,                      -- the story this item belongs to
  outlet         text,                      -- the real PUBLISHER (domain), not the feed
  topic          text,
  entities       text[] default '{}',
  velocity       double precision default 0,
  points_prev    int,
  points_prev_at timestamptz,
  is_wire        boolean default false
);

create index if not exists ai_news_published_idx on public.ai_news (published_at desc);
create index if not exists ai_news_score_idx     on public.ai_news (score desc);
create index if not exists ai_news_cluster_idx   on public.ai_news (cluster_id);
create index if not exists ai_news_inserted_idx  on public.ai_news (inserted_at desc);

alter table public.ai_news enable row level security;
drop policy if exists "public read" on public.ai_news;
create policy "public read" on public.ai_news for select using (true);

-- ---------- stories: one row per real-world EVENT ----------
create table if not exists public.signal_stories (
  cluster_id    text primary key,
  title         text not null,
  url           text not null,
  outlet        text,
  sources       text[] default '{}',
  outlets       text[] default '{}',   -- distinct independent publishers
  corroboration int  default 1,        -- min(outlets, distinct headlines)
  variants      int  default 1,
  verdict       text,                  -- CONFIRMED | DEVELOPING | SINGLE SOURCE | WIRE
  signal        double precision default 0,
  hype          double precision default 0,
  points        int  default 0,
  comments      int  default 0,
  velocity      double precision default 0,
  topic         text,
  entities      text[] default '{}',
  item_count    int  default 1,
  press_count   int  default 0,
  primary_count int  default 0,
  first_seen    timestamptz,
  published_at  timestamptz not null,
  updated_at    timestamptz default now()
);

create index if not exists signal_stories_signal_idx    on public.signal_stories (signal desc);
create index if not exists signal_stories_published_idx on public.signal_stories (published_at desc);
create index if not exists signal_stories_topic_idx     on public.signal_stories (topic);
create index if not exists signal_stories_corrob_idx    on public.signal_stories (corroboration desc);

alter table public.signal_stories enable row level security;
drop policy if exists "public read stories" on public.signal_stories;
create policy "public read stories" on public.signal_stories for select using (true);

-- ---------- market quotes for the ticker ----------
create table if not exists public.ai_quotes (
  symbol     text primary key,
  price      double precision,
  change_pct double precision,
  prev_close double precision,
  updated_at timestamptz default now()
);

alter table public.ai_quotes enable row level security;
drop policy if exists "public read quotes" on public.ai_quotes;
create policy "public read quotes" on public.ai_quotes for select using (true);

-- ---------- THE MAP: topic tiles, sized by attention, coloured by momentum ----------
create or replace view public.topic_map with (security_invoker = true) as
select
  coalesce(topic, 'other')                                                                    as topic,
  count(*) filter (where published_at > now() - interval '24 hours')::int                     as stories,
  count(*) filter (where published_at <= now() - interval '24 hours')::int                    as prior_stories,
  coalesce(sum(signal) filter (where published_at > now() - interval '24 hours'), 0)::double precision as signal,
  coalesce(sum(points) filter (where published_at > now() - interval '24 hours'), 0)::int     as points,
  coalesce(max(corroboration) filter (where published_at > now() - interval '24 hours'), 0)::int as top_corroboration
from public.signal_stories
where published_at > now() - interval '48 hours'
group by 1;

-- ---------- LAB RACE ----------
create or replace view public.lab_race with (security_invoker = true) as
select
  e                                                                                            as lab,
  count(*) filter (where published_at > now() - interval '24 hours')::int                      as stories_24h,
  count(*)::int                                                                                as stories_7d,
  coalesce(sum(signal) filter (where published_at > now() - interval '24 hours'), 0)::double precision as signal_24h,
  coalesce(sum(points) filter (where published_at > now() - interval '24 hours'), 0)::int      as points_24h,
  coalesce(max(corroboration) filter (where published_at > now() - interval '24 hours'), 0)::int as top_corroboration,
  max(published_at)                                                                            as last_seen
from public.signal_stories, unnest(entities) e
where published_at > now() - interval '7 days'
group by 1;

-- ---------- hourly volume (velocity sparkline) ----------
create or replace view public.ai_news_hourly with (security_invoker = true) as
select date_trunc('hour', published_at) as hour, count(*)::int as n
from public.ai_news
where published_at > now() - interval '48 hours'
group by 1 order by 1;

-- ============================================================
-- Schedule the ingest worker every 5 minutes.
-- Replace <PROJECT_REF> and <ANON_KEY> before running this block.
-- The anon key here only satisfies the function's JWT check; every
-- write inside the function uses the service role from its own env.
-- ============================================================
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule('signal-noise-ingest-5min', '*/5 * * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/signal-noise-ingest',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <ANON_KEY>',
--       'Content-Type', 'application/json'),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 150000);
-- $$);
