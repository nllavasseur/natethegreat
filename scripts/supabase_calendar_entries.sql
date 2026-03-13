-- Calendar snapshot table for fast month-window queries on cellular.
-- Run this in Supabase SQL editor.

create table if not exists public.calendar_entries (
  workspace_id uuid not null,
  draft_id text not null,
  updated_at timestamptz null,
  created_at_ms bigint null,
  updated_at_ms bigint null,

  status text null,
  calendar_hidden boolean not null default false,

  scheduled_iso text null,
  install_date text null,
  start_date text null,
  hold_date text null,

  labor_days double precision null,
  queue_rank double precision null,
  allow_saturday boolean null,
  allow_sunday boolean null,
  estimate_assignee text null,

  customer_name text null,
  title text null,
  phone_number text null,
  project_address text null,
  selected_style jsonb null,

  primary key (workspace_id, draft_id)
);

alter table public.calendar_entries add column if not exists phone_number text;

create index if not exists calendar_entries_workspace_scheduled_idx
  on public.calendar_entries (workspace_id, scheduled_iso);

create index if not exists calendar_entries_workspace_status_idx
  on public.calendar_entries (workspace_id, status);

create index if not exists calendar_entries_workspace_queue_idx
  on public.calendar_entries (workspace_id, queue_rank);

drop function if exists public.vf_calendar_entry_from_draft(jsonb);

create or replace function public.vf_calendar_entry_from_draft(d jsonb)
returns table(
  status text,
  calendar_hidden boolean,
  scheduled_iso text,
  install_date text,
  start_date text,
  hold_date text,
  labor_days double precision,
  queue_rank double precision,
  allow_saturday boolean,
  allow_sunday boolean,
  estimate_assignee text,
  customer_name text,
  title text,
  phone_number text,
  project_address text,
  selected_style jsonb,
  created_at_ms bigint,
  updated_at_ms bigint
)
language sql
stable
as $$
  select
    nullif(d->>'status','') as status,
    coalesce((d->>'calendarHidden')::boolean,false) as calendar_hidden,
    nullif(left(coalesce(d->>'scheduledAt',''),10),'') as scheduled_iso,
    nullif(left(coalesce(d->>'installDate',''),10),'') as install_date,
    nullif(left(coalesce(d->>'startDate',''),10),'') as start_date,
    nullif(left(coalesce(d->>'holdDate',''),10),'') as hold_date,
    nullif((d->>'laborDays')::double precision, null) as labor_days,
    nullif((d->>'queueRank')::double precision, null) as queue_rank,
    nullif((d->>'allowSaturday')::boolean, null) as allow_saturday,
    nullif((d->>'allowSunday')::boolean, null) as allow_sunday,
    nullif(d->>'estimateAssignee','') as estimate_assignee,
    nullif(d->>'customerName','') as customer_name,
    nullif(d->>'title','') as title,
    nullif(d->>'phoneNumber','') as phone_number,
    nullif(d->>'projectAddress','') as project_address,
    d->'selectedStyle' as selected_style,
    nullif((d->>'createdAt')::bigint, null) as created_at_ms,
    nullif((d->>'updatedAt')::bigint, null) as updated_at_ms;
$$;

create or replace function public.vf_sync_calendar_entry()
returns trigger
language plpgsql
security definer
as $$
declare
  v record;
  d jsonb;
  did text;
begin
  if (tg_op = 'DELETE') then
    delete from public.calendar_entries where workspace_id = old.workspace_id and draft_id = old.draft_id;
    return old;
  end if;

  d := new.draft;
  did := coalesce(new.draft_id, d->>'id');

  select * into v from public.vf_calendar_entry_from_draft(d);

  insert into public.calendar_entries (
    workspace_id, draft_id, updated_at,
    created_at_ms, updated_at_ms,
    status, calendar_hidden,
    scheduled_iso, install_date, start_date, hold_date,
    labor_days, queue_rank, allow_saturday, allow_sunday, estimate_assignee,
    customer_name, title, phone_number, project_address, selected_style
  ) values (
    new.workspace_id, did, new.updated_at,
    v.created_at_ms, v.updated_at_ms,
    v.status, coalesce(v.calendar_hidden,false),
    v.scheduled_iso, v.install_date, v.start_date, v.hold_date,
    v.labor_days, v.queue_rank, v.allow_saturday, v.allow_sunday, v.estimate_assignee,
    v.customer_name, v.title, v.phone_number, v.project_address, v.selected_style
  )
  on conflict (workspace_id, draft_id) do update set
    updated_at = excluded.updated_at,
    created_at_ms = excluded.created_at_ms,
    updated_at_ms = excluded.updated_at_ms,
    status = excluded.status,
    calendar_hidden = excluded.calendar_hidden,
    scheduled_iso = excluded.scheduled_iso,
    install_date = excluded.install_date,
    start_date = excluded.start_date,
    hold_date = excluded.hold_date,
    labor_days = excluded.labor_days,
    queue_rank = excluded.queue_rank,
    allow_saturday = excluded.allow_saturday,
    allow_sunday = excluded.allow_sunday,
    estimate_assignee = excluded.estimate_assignee,
    customer_name = excluded.customer_name,
    title = excluded.title,
    phone_number = excluded.phone_number,
    project_address = excluded.project_address,
    selected_style = excluded.selected_style;

  return new;
end;
$$;

drop trigger if exists vf_sync_calendar_entry_trigger on public.drafts;
create trigger vf_sync_calendar_entry_trigger
after insert or update or delete on public.drafts
for each row execute procedure public.vf_sync_calendar_entry();

-- One-time backfill
insert into public.calendar_entries (
  workspace_id, draft_id, updated_at,
  created_at_ms, updated_at_ms,
  status, calendar_hidden,
  scheduled_iso, install_date, start_date, hold_date,
  labor_days, queue_rank, allow_saturday, allow_sunday, estimate_assignee,
  customer_name, title, phone_number, project_address, selected_style
)
select
  d.workspace_id,
  d.draft_id,
  d.updated_at,
  v.created_at_ms,
  v.updated_at_ms,
  v.status,
  coalesce(v.calendar_hidden,false),
  v.scheduled_iso,
  v.install_date,
  v.start_date,
  v.hold_date,
  v.labor_days,
  v.queue_rank,
  v.allow_saturday,
  v.allow_sunday,
  v.estimate_assignee,
  v.customer_name,
  v.title,
  v.phone_number,
  v.project_address,
  v.selected_style
from public.drafts d
cross join lateral public.vf_calendar_entry_from_draft(d.draft) v
on conflict (workspace_id, draft_id) do update set
  updated_at = excluded.updated_at,
  created_at_ms = excluded.created_at_ms,
  updated_at_ms = excluded.updated_at_ms,
  status = excluded.status,
  calendar_hidden = excluded.calendar_hidden,
  scheduled_iso = excluded.scheduled_iso,
  install_date = excluded.install_date,
  start_date = excluded.start_date,
  hold_date = excluded.hold_date,
  labor_days = excluded.labor_days,
  queue_rank = excluded.queue_rank,
  allow_saturday = excluded.allow_saturday,
  allow_sunday = excluded.allow_sunday,
  estimate_assignee = excluded.estimate_assignee,
  customer_name = excluded.customer_name,
  title = excluded.title,
  phone_number = excluded.phone_number,
  project_address = excluded.project_address,
  selected_style = excluded.selected_style;
