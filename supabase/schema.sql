-- Standalone Chatbot Supabase project (NOT shared with other apps).
-- Text + metadata → SQL. Binary media → Storage bucket `chatbot-media`.

create extension if not exists "pgcrypto";

-- App users mirrored from auth.users (every login lands here)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  avatar_url text,
  provider text,
  last_login timestamptz,
  login_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text default 'Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx
  on public.conversations (user_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  -- text → SQL content; image/audio/video/file → Storage + path columns
  content_type text not null default 'text'
    check (content_type in ('text', 'image', 'audio', 'video', 'file', 'mixed')),
  content text,
  media_bucket text,
  media_path text,
  media_mime text,
  media_size integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx
  on public.messages (conversation_id, created_at);

create index if not exists messages_user_id_idx
  on public.messages (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Clients can read/update their own profile; server (service role) bypasses RLS for writes.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "conversations_select_own" on public.conversations
  for select using (auth.uid() = user_id);

create policy "messages_select_own" on public.messages
  for select using (auth.uid() = user_id);

-- Auto-create profile row when a user signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, provider, last_login, login_count)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    now(),
    1
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chatbot-media',
  'chatbot-media',
  false,
  10485760,
  array['image/*', 'audio/*', 'video/*', 'application/pdf', 'text/plain']::text[]
)
on conflict (id) do nothing;
