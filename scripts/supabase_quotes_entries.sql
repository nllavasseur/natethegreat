-- Quotes list snapshot table for fast /quotes loading on cellular.
-- Run this in Supabase SQL editor.

create table if not exists public.quotes_entries (
  workspace_id uuid not null,
  draft_id text not null,
  updated_at timestamptz null,
  created_at_ms bigint null,
  updated_at_ms bigint null,

  status text null,
  calendar_hidden boolean not null default false,

  scheduled_iso text null,
  scheduled_day text null,
  scheduled_at text null,
  install_date text null,
  start_date text null,

  labor_days double precision null,
  queue_rank double precision null,
  estimate_assignee text null,

  customer_name text null,
  title text null,
  phone_number text null,
  project_address text null,
  selected_style_name text null,

  project_photo_url text null,
  preinstall_count integer null,

  totals jsonb null,

  job_tasks jsonb null,
  job_task_snooze jsonb null,

  primary key (workspace_id, draft_id)
);

alter table public.quotes_entries add column if not exists scheduled_day text;
alter table public.quotes_entries add column if not exists scheduled_at text;

create index if not exists quotes_entries_workspace_status_idx
  on public.quotes_entries (workspace_id, status);

create index if not exists quotes_entries_workspace_updated_idx
  on public.quotes_entries (workspace_id, updated_at);

create index if not exists quotes_entries_workspace_queue_idx
  on public.quotes_entries (workspace_id, queue_rank);

create index if not exists quotes_entries_workspace_scheduled_day_idx
  on public.quotes_entries (workspace_id, scheduled_day);

-- If you are upgrading an existing function, Postgres cannot CREATE OR REPLACE
-- when the OUT/return row type changes. Drop dependent objects first.
drop trigger if exists vf_sync_quotes_entry_trigger on public.drafts;
drop function if exists public.vf_sync_quotes_entry();
drop function if exists public.vf_quotes_entry_from_draft(jsonb);

drop trigger if exists vf_guard_drafts_destructive_trigger on public.drafts;
drop function if exists public.vf_guard_drafts_destructive_update();

create or replace function public.vf_guard_drafts_destructive_update()
returns trigger
language plpgsql
security definer
as $$
declare
  allow_destructive boolean;
  is_reserved boolean;
  removed_fields text;
begin
  if (tg_op <> 'UPDATE') then
    return new;
  end if;

  is_reserved := (coalesce(new.draft_id,'') in ('vf_calendar_blockouts_v1','vf_calendar_tasks_v1'))
    or (coalesce(new.draft->>'kind','') in ('calendar_blockouts','calendar_tasks'));
  if (is_reserved) then
    return new;
  end if;

  allow_destructive := coalesce((new.draft->>'_allowDestructiveUpdate')::boolean, false);
  if (allow_destructive) then
    -- Never persist the bypass flag.
    new.draft := new.draft - '_allowDestructiveUpdate';
    return new;
  end if;

  -- Never persist the bypass flag.
  new.draft := new.draft - '_allowDestructiveUpdate';

  removed_fields := '';

  if (
    jsonb_typeof(old.draft->'items') = 'array'
    and jsonb_array_length(old.draft->'items') > 0
    and not (
      jsonb_typeof(new.draft->'items') = 'array'
      and jsonb_array_length(new.draft->'items') > 0
    )
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'items';
  end if;

  if (
    jsonb_typeof(old.draft->'takeoffMaterials') = 'array'
    and jsonb_array_length(old.draft->'takeoffMaterials') > 0
    and not (
      jsonb_typeof(new.draft->'takeoffMaterials') = 'array'
      and jsonb_array_length(new.draft->'takeoffMaterials') > 0
    )
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'takeoffMaterials';
  end if;

  if (
    jsonb_typeof(old.draft->'takeoffManualItems') = 'array'
    and jsonb_array_length(old.draft->'takeoffManualItems') > 0
    and not (
      jsonb_typeof(new.draft->'takeoffManualItems') = 'array'
      and jsonb_array_length(new.draft->'takeoffManualItems') > 0
    )
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'takeoffManualItems';
  end if;

  if (
    (old.draft ? 'totals')
    and old.draft->'totals' is not null
    and jsonb_typeof(old.draft->'totals') = 'object'
    and not (
      (new.draft ? 'totals')
      and new.draft->'totals' is not null
      and jsonb_typeof(new.draft->'totals') = 'object'
    )
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'totals';
  end if;

  if (
    jsonb_typeof(old.draft->'photos') = 'array'
    and jsonb_array_length(old.draft->'photos') > 0
    and not (
      jsonb_typeof(new.draft->'photos') = 'array'
      and jsonb_array_length(new.draft->'photos') > 0
    )
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'photos';
  end if;

  if (
    jsonb_typeof(old.draft->'preInstallPhotos') = 'array'
    and jsonb_array_length(old.draft->'preInstallPhotos') > 0
    and not (
      jsonb_typeof(new.draft->'preInstallPhotos') = 'array'
      and jsonb_array_length(new.draft->'preInstallPhotos') > 0
    )
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'preInstallPhotos';
  end if;

  if (
    coalesce(old.draft->>'projectPhotoUrl','') <> ''
    and coalesce(new.draft->>'projectPhotoUrl','') = ''
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'projectPhotoUrl';
  end if;

  if (
    coalesce(old.draft->>'projectPhotoDataUrl','') <> ''
    and coalesce(new.draft->>'projectPhotoDataUrl','') = ''
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'projectPhotoDataUrl';
  end if;

  if (
    (old.draft ? 'contract')
    and old.draft->'contract' is not null
    and not ((new.draft ? 'contract') and new.draft->'contract' is not null)
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'contract';
  end if;

  if (
    (old.draft ? 'fenceBuilder')
    and old.draft->'fenceBuilder' is not null
    and not ((new.draft ? 'fenceBuilder') and new.draft->'fenceBuilder' is not null)
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'fenceBuilder';
  end if;

  if (
    (old.draft ? 'jobTasks')
    and old.draft->'jobTasks' is not null
    and not ((new.draft ? 'jobTasks') and new.draft->'jobTasks' is not null)
  ) then
    removed_fields := removed_fields || case when removed_fields = '' then '' else ',' end || 'jobTasks';
  end if;

  if (removed_fields <> '') then
    raise exception 'Destructive drafts update blocked for draft_id=% (removed fields: %). Include _allowDestructiveUpdate=true to override.', coalesce(new.draft_id,''), removed_fields
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger vf_guard_drafts_destructive_trigger
before update on public.drafts
for each row execute procedure public.vf_guard_drafts_destructive_update();

create or replace function public.vf_quotes_entry_from_draft(d jsonb)
returns table(
  status text,
  calendar_hidden boolean,
  scheduled_iso text,
  scheduled_day text,
  scheduled_at text,
  install_date text,
  start_date text,
  labor_days double precision,
  queue_rank double precision,
  estimate_assignee text,
  customer_name text,
  title text,
  phone_number text,
  project_address text,
  selected_style_name text,
  project_photo_url text,
  preinstall_count integer,
  totals jsonb,
  job_tasks jsonb,
  job_task_snooze jsonb,
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
    nullif(left(coalesce(d->>'scheduledAt',''),10),'') as scheduled_day,
    nullif(coalesce(d->>'scheduledAt',''),'') as scheduled_at,
    nullif(left(coalesce(d->>'installDate',''),10),'') as install_date,
    nullif(left(coalesce(d->>'startDate',''),10),'') as start_date,
    nullif((d->>'laborDays')::double precision, null) as labor_days,
    nullif((d->>'queueRank')::double precision, null) as queue_rank,
    nullif(d->>'estimateAssignee','') as estimate_assignee,
    nullif(d->>'customerName','') as customer_name,
    nullif(d->>'title','') as title,
    nullif(d->>'phoneNumber','') as phone_number,
    nullif(d->>'projectAddress','') as project_address,
    nullif(coalesce(d->'selectedStyle'->>'name',''),'') as selected_style_name,
    nullif(d->>'projectPhotoUrl','') as project_photo_url,
    (
      select count(*)::integer
      from jsonb_array_elements(coalesce(d->'preInstallPhotos','[]'::jsonb)) as p
      where coalesce(p->>'src','') <> '' and left(p->>'src',5) <> 'data:'
    ) as preinstall_count,
    d->'totals' as totals,
    d->'jobTasks' as job_tasks,
    d->'jobTaskSnooze' as job_task_snooze,
    nullif((d->>'createdAt')::bigint, null) as created_at_ms,
    nullif((d->>'updatedAt')::bigint, null) as updated_at_ms;
$$;

create or replace function public.vf_sync_quotes_entry()
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
    delete from public.quotes_entries where workspace_id = old.workspace_id and draft_id = old.draft_id;
    return old;
  end if;

  d := new.draft;
  did := coalesce(new.draft_id, d->>'id');

  select * into v from public.vf_quotes_entry_from_draft(d);

  insert into public.quotes_entries (
    workspace_id, draft_id, updated_at,
    created_at_ms, updated_at_ms,
    status, calendar_hidden,
    scheduled_iso, scheduled_day, scheduled_at, install_date, start_date,
    labor_days, queue_rank, estimate_assignee,
    customer_name, title, phone_number, project_address, selected_style_name,
    project_photo_url, preinstall_count,
    totals,
    job_tasks, job_task_snooze
  ) values (
    new.workspace_id, did, new.updated_at,
    v.created_at_ms, v.updated_at_ms,
    v.status, coalesce(v.calendar_hidden,false),
    v.scheduled_iso, v.scheduled_day, v.scheduled_at, v.install_date, v.start_date,
    v.labor_days, v.queue_rank, v.estimate_assignee,
    v.customer_name, v.title, v.phone_number, v.project_address, v.selected_style_name,
    v.project_photo_url, v.preinstall_count,
    v.totals,
    v.job_tasks, v.job_task_snooze
  )
  on conflict (workspace_id, draft_id) do update set
    updated_at = excluded.updated_at,
    created_at_ms = excluded.created_at_ms,
    updated_at_ms = excluded.updated_at_ms,
    status = excluded.status,
    calendar_hidden = excluded.calendar_hidden,
    scheduled_iso = excluded.scheduled_iso,
    scheduled_day = excluded.scheduled_day,
    scheduled_at = excluded.scheduled_at,
    install_date = excluded.install_date,
    start_date = excluded.start_date,
    labor_days = excluded.labor_days,
    queue_rank = excluded.queue_rank,
    estimate_assignee = excluded.estimate_assignee,
    customer_name = excluded.customer_name,
    title = excluded.title,
    phone_number = excluded.phone_number,
    project_address = excluded.project_address,
    selected_style_name = excluded.selected_style_name,
    project_photo_url = excluded.project_photo_url,
    preinstall_count = excluded.preinstall_count,
    totals = excluded.totals,
    job_tasks = excluded.job_tasks,
    job_task_snooze = excluded.job_task_snooze;

  return new;
end;
$$;

drop trigger if exists vf_sync_quotes_entry_trigger on public.drafts;
create trigger vf_sync_quotes_entry_trigger
after insert or update or delete on public.drafts
for each row execute procedure public.vf_sync_quotes_entry();

-- One-time backfill
insert into public.quotes_entries (
  workspace_id, draft_id, updated_at,
  created_at_ms, updated_at_ms,
  status, calendar_hidden,
  scheduled_iso, scheduled_day, scheduled_at, install_date, start_date,
  labor_days, queue_rank, estimate_assignee,
  customer_name, title, phone_number, project_address, selected_style_name,
  project_photo_url, preinstall_count,
  totals,
  job_tasks, job_task_snooze
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
  v.scheduled_day,
  v.scheduled_at,
  v.install_date,
  v.start_date,
  v.labor_days,
  v.queue_rank,
  v.estimate_assignee,
  v.customer_name,
  v.title,
  v.phone_number,
  v.project_address,
  v.selected_style_name,
  v.project_photo_url,
  v.preinstall_count,
  v.totals,
  v.job_tasks,
  v.job_task_snooze
from public.drafts d
cross join lateral public.vf_quotes_entry_from_draft(d.draft) v
on conflict (workspace_id, draft_id) do nothing;
