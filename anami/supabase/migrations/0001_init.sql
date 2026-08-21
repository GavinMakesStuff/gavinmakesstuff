-- supabase/migrations/0001_init.sql
create extension if not exists "pgcrypto";

create table editions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  edition_date date not null,
  status text not null default 'generating' check (status in ('generating', 'published', 'failed')),
  generated_at timestamptz,
  read_time_minutes integer,
  created_at timestamptz not null default now(),
  unique (user_id, edition_date)
);

create table interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  type text not null check (type in ('industry', 'topic')),
  label text not null,
  parent_interest_id uuid references interests(id),
  weight numeric not null default 1.0,
  created_at timestamptz not null default now()
);

create table stories (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  module text not null check (module in ('world', 'industry', 'marginalia')),
  headline text not null,
  summary text not null,
  why_it_matters text not null,
  source_urls text[] not null default '{}',
  interest_id uuid references interests(id),
  rank_position integer not null,
  created_at timestamptz not null default now()
);

create table marginalia_highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  book_title text not null,
  excerpt text not null,
  note_text text,
  source_created_at timestamptz not null,
  last_surfaced_at timestamptz,
  feedback_boost numeric not null default 1.0,
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  story_id uuid not null references stories(id) on delete cascade,
  action text not null check (action in ('thumbs_up', 'thumbs_down', 'save', 'not_interested')),
  created_at timestamptz not null default now()
);

create table saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  story_id uuid not null references stories(id) on delete cascade,
  saved_at timestamptz not null default now(),
  category text not null default 'articles',
  unique (user_id, story_id)
);

create index stories_edition_id_idx on stories(edition_id);
create index feedback_story_id_idx on feedback(story_id);
create index saved_items_user_id_idx on saved_items(user_id);
