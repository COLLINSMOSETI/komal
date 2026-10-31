create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  name text not null,
  phone text not null,
  event_type text not null check (event_type in ('login', 'signup')),
  logged_in_at timestamptz not null
);

alter table public.login_events enable row level security;
revoke all on table public.login_events from public, anon, authenticated;
grant insert, select on table public.login_events to service_role;

revoke all on sequence public.login_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.login_events_id_seq to service_role;
