create table if not exists public.campusflow_app_state (
  id text primary key check (id = 'main'),
  state jsonb not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

alter table public.campusflow_app_state enable row level security;

revoke all on table public.campusflow_app_state from anon, authenticated;
grant select, insert, update on table public.campusflow_app_state to service_role;
