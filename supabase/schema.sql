-- HSK Learning: sync schema for Supabase.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query)
-- against a fresh project. It is idempotent, so re-running it is safe.
--
-- Design notes:
--   * Progress is one row per user per card, so two devices can merge per card
--     with last-write-wins on client_updated_at. No whole-blob overwrites, and
--     no way for one device to clobber another's day of study.
--   * Card ids are TEXT because deck cards use numeric ids (1..15960) and custom
--     words use 'custom-<uuid>'.
--   * custom_words has a soft-delete flag. A hard delete on one device would be
--     silently resurrected by a stale device on its next sync.
--   * Every table is owner-only via row level security. The anon key is safe in
--     the client because RLS, not secrecy, enforces access.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.card_progress (
  user_id         uuid not null references auth.users (id) on delete cascade,
  card_id         text not null,
  level           int  not null default 0,
  ease            real not null default 2.5,
  interval_days   int  not null default 0,
  reps            int  not null default 0,
  lapses          int  not null default 0,
  next_review     bigint not null default 0,
  last_reviewed   bigint not null default 0,
  correct_count   int  not null default 0,
  incorrect_count int  not null default 0,
  client_updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create index if not exists card_progress_user_updated_idx
  on public.card_progress (user_id, client_updated_at desc);

create table if not exists public.custom_words (
  user_id         uuid not null references auth.users (id) on delete cascade,
  id              text not null,
  hanzi           text not null,
  pinyin          text not null,
  meaning         text not null,
  part_of_speech  text,
  example_hanzi   text,
  example_pinyin  text,
  example_english text,
  deleted         boolean not null default false,
  client_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists custom_words_user_updated_idx
  on public.custom_words (user_id, client_updated_at desc);

create table if not exists public.user_settings (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  dark_mode     boolean not null default false,
  reverse_mode  boolean not null default false,
  levels        jsonb   not null default '[3]'::jsonb,
  goal          int     not null default 20,
  client_updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security: a user can only ever see and write their own rows
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.card_progress enable row level security;
alter table public.custom_words  enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own progress" on public.card_progress;
create policy "own progress" on public.card_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own custom words" on public.custom_words;
create policy "own custom words" on public.custom_words
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Create a profile row when a user signs up
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
