-- Canonical schema: quotes + jobs + calendar_blockouts
-- Non-destructive: does not drop legacy tables.
-- Run this in Supabase SQL editor.

-- Ensure extensions needed for gen_random_uuid (available on Supabase by default)
create extension if not exists pgcrypto;

-- Drafts compatibility: older schemas used workspace/workspaceId instead of workspace_id.
-- The app and snapshot triggers assume workspace_id.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'drafts'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'drafts' and column_name = 'workspace_id'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'drafts' and column_name = 'workspaceId'
    ) then
      execute 'alter table public.drafts rename column "workspaceId" to workspace_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'drafts' and column_name = 'workspaceid'
    ) then
      execute 'alter table public.drafts rename column workspaceid to workspace_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'drafts' and column_name = 'workspace'
    ) then
      execute 'alter table public.drafts rename column workspace to workspace_id';
    end if;
  end if;
end;
$$;
-- 1) Canonical tables
create table if not exists public.vf_quotes (
  workspace_id uuid not null,
  id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text null,
  calendar_hidden boolean not null default false,
  queue_rank numeric null,
  labor_days numeric null,
  original_labor_days numeric null,
  allow_saturday boolean null,
  allow_sunday boolean null,
  hold_date date null,
  estimate_assignee text null,
  customer_name text null,
  phone_number text null,
  project_address text null,
  title text null,
  selected_style jsonb null,
  totals jsonb null,
  scheduled_at text null,
  project_photo_url text null,
  preinstall_count integer null,
  data jsonb not null default '{}'::jsonb,
  primary key (workspace_id, id)
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vf_quotes' and column_name = 'workspace_id'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_quotes' and column_name = 'workspaceId'
    ) then
      execute 'alter table public.vf_quotes rename column "workspaceId" to workspace_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_quotes' and column_name = 'workspaceid'
    ) then
      execute 'alter table public.vf_quotes rename column workspaceid to workspace_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_quotes' and column_name = 'workspace'
    ) then
      execute 'alter table public.vf_quotes rename column workspace to workspace_id';
    else
      execute 'alter table public.vf_quotes add column workspace_id uuid';
    end if;
  end if;
end;
$$;

alter table public.vf_quotes add column if not exists scheduled_at text;
alter table public.vf_quotes add column if not exists project_photo_url text;
alter table public.vf_quotes add column if not exists preinstall_count integer;

create index if not exists vf_quotes_workspace_updated_idx on public.vf_quotes (workspace_id, updated_at desc);
create index if not exists vf_quotes_workspace_status_idx on public.vf_quotes (workspace_id, status);
create index if not exists vf_quotes_workspace_queue_idx on public.vf_quotes (workspace_id, queue_rank);
create unique index if not exists vf_quotes_workspace_id_id_uniq on public.vf_quotes (workspace_id, id);

create table if not exists public.vf_jobs (
  workspace_id uuid not null,
  id uuid not null default gen_random_uuid(),
  quote_id text not null,
  start_date date not null,
  duration_half_days int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  unique (workspace_id, quote_id)
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vf_jobs' and column_name = 'workspace_id'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_jobs' and column_name = 'workspaceId'
    ) then
      execute 'alter table public.vf_jobs rename column "workspaceId" to workspace_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_jobs' and column_name = 'workspaceid'
    ) then
      execute 'alter table public.vf_jobs rename column workspaceid to workspace_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_jobs' and column_name = 'workspace'
    ) then
      execute 'alter table public.vf_jobs rename column workspace to workspace_id';
    else
      execute 'alter table public.vf_jobs add column workspace_id uuid';
    end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vf_jobs' and column_name = 'quote_id'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_jobs' and column_name = 'quoteId'
    ) then
      execute 'alter table public.vf_jobs rename column "quoteId" to quote_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_jobs' and column_name = 'quoteid'
    ) then
      execute 'alter table public.vf_jobs rename column quoteid to quote_id';
    end if;
  end if;
end;
$$;

create index if not exists vf_jobs_workspace_start_idx on public.vf_jobs (workspace_id, start_date);
create index if not exists vf_jobs_workspace_quote_idx on public.vf_jobs (workspace_id, quote_id);
create unique index if not exists vf_jobs_workspace_quote_id_uniq on public.vf_jobs (workspace_id, quote_id);

alter table public.vf_jobs
  drop constraint if exists vf_jobs_workspace_quote_fk;

alter table public.vf_jobs
  add constraint vf_jobs_workspace_quote_fk foreign key (workspace_id, quote_id)
  references public.vf_quotes (workspace_id, id) on delete cascade;

create table if not exists public.vf_calendar_blockouts (
  workspace_id uuid not null,
  id text not null,
  start_date date not null,
  end_date date not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vf_calendar_blockouts' and column_name = 'workspace_id'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_calendar_blockouts' and column_name = 'workspaceId'
    ) then
      execute 'alter table public.vf_calendar_blockouts rename column "workspaceId" to workspace_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_calendar_blockouts' and column_name = 'workspaceid'
    ) then
      execute 'alter table public.vf_calendar_blockouts rename column workspaceid to workspace_id';
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vf_calendar_blockouts' and column_name = 'workspace'
    ) then
      execute 'alter table public.vf_calendar_blockouts rename column workspace to workspace_id';
    else
      execute 'alter table public.vf_calendar_blockouts add column workspace_id uuid';
    end if;
  end if;
end;
$$;

create index if not exists vf_calendar_blockouts_workspace_start_idx on public.vf_calendar_blockouts (workspace_id, start_date);
create unique index if not exists vf_calendar_blockouts_workspace_id_id_uniq on public.vf_calendar_blockouts (workspace_id, id);

-- 2) Backfill quotes from drafts (excluding reserved calendar docs)
insert into public.vf_quotes (
  workspace_id,
  id,
  updated_at,
  status,
  calendar_hidden,
  queue_rank,
  labor_days,
  original_labor_days,
  allow_saturday,
  allow_sunday,
  hold_date,
  estimate_assignee,
  customer_name,
  phone_number,
  project_address,
  title,
  selected_style,
  totals,
  scheduled_at,
  project_photo_url,
  preinstall_count,
  data
)
select
  d.workspace_id,
  d.draft_id as id,
  coalesce(d.updated_at, now()) as updated_at,
  nullif(d.draft->>'status','') as status,
  coalesce((d.draft->>'calendarHidden')::boolean,false) as calendar_hidden,
  nullif((d.draft->>'queueRank')::numeric, null) as queue_rank,
  nullif((d.draft->>'laborDays')::numeric, null) as labor_days,
  nullif((d.draft->>'originalLaborDays')::numeric, null) as original_labor_days,
  nullif((d.draft->>'allowSaturday')::boolean, null) as allow_saturday,
  nullif((d.draft->>'allowSunday')::boolean, null) as allow_sunday,
  nullif(left(coalesce(d.draft->>'holdDate',''),10),'')::date as hold_date,
  nullif(d.draft->>'estimateAssignee','') as estimate_assignee,
  nullif(d.draft->>'customerName','') as customer_name,
  nullif(d.draft->>'phoneNumber','') as phone_number,
  nullif(d.draft->>'projectAddress','') as project_address,
  nullif(d.draft->>'title','') as title,
  d.draft->'selectedStyle' as selected_style,
  d.draft->'totals' as totals,
  nullif(coalesce(d.draft->>'scheduledAt',''), '') as scheduled_at,
  nullif(d.draft->>'projectPhotoUrl','') as project_photo_url,
  (
    case
      when jsonb_typeof(d.draft->'preInstallPhotos') = 'array' then jsonb_array_length(d.draft->'preInstallPhotos')
      when coalesce(d.draft->>'preInstallCount','') ~ '^[0-9]+$' then (d.draft->>'preInstallCount')::int
      else null
    end
  ) as preinstall_count,
  coalesce(d.draft,'{}'::jsonb) as data
from public.drafts d
where coalesce(d.draft_id,'') not in ('vf_calendar_blockouts_v1','vf_calendar_tasks_v1')
  and coalesce(d.draft->>'kind','') not in ('calendar_blockouts','calendar_tasks')
on conflict (workspace_id, id) do update set
  updated_at = excluded.updated_at,
  status = excluded.status,
  calendar_hidden = excluded.calendar_hidden,
  queue_rank = excluded.queue_rank,
  labor_days = excluded.labor_days,
  original_labor_days = excluded.original_labor_days,
  allow_saturday = excluded.allow_saturday,
  allow_sunday = excluded.allow_sunday,
  hold_date = excluded.hold_date,
  estimate_assignee = excluded.estimate_assignee,
  customer_name = excluded.customer_name,
  phone_number = excluded.phone_number,
  project_address = excluded.project_address,
  title = excluded.title,
  selected_style = excluded.selected_style,
  totals = excluded.totals,
  scheduled_at = excluded.scheduled_at,
  project_photo_url = excluded.project_photo_url,
  preinstall_count = excluded.preinstall_count,
  data = excluded.data;

-- 3) Backfill jobs from drafts that look scheduled
-- start_date: startDate || installDate || scheduledAt day
insert into public.vf_jobs (workspace_id, quote_id, start_date, duration_half_days)
select
  d.workspace_id,
  d.draft_id as quote_id,
  (
    nullif(left(coalesce(d.draft->>'startDate',''),10),'')::date
  ) as start_date,
  greatest(1, ceil(coalesce((d.draft->>'laborDays')::numeric, 1) * 2))::int as duration_half_days
from public.drafts d
where coalesce(d.draft_id,'') not in ('vf_calendar_blockouts_v1','vf_calendar_tasks_v1')
  and coalesce(d.draft->>'kind','') not in ('calendar_blockouts','calendar_tasks')
  and nullif(left(coalesce(d.draft->>'startDate',''),10),'') is not null
on conflict (workspace_id, quote_id) do update set
  start_date = excluded.start_date,
  duration_half_days = excluded.duration_half_days,
  updated_at = now();

insert into public.vf_jobs (workspace_id, quote_id, start_date, duration_half_days)
select
  d.workspace_id,
  d.draft_id as quote_id,
  (
    nullif(left(coalesce(d.draft->>'installDate',''),10),'')::date
  ) as start_date,
  greatest(1, ceil(coalesce((d.draft->>'laborDays')::numeric, 1) * 2))::int as duration_half_days
from public.drafts d
where coalesce(d.draft_id,'') not in ('vf_calendar_blockouts_v1','vf_calendar_tasks_v1')
  and coalesce(d.draft->>'kind','') not in ('calendar_blockouts','calendar_tasks')
  and nullif(left(coalesce(d.draft->>'startDate',''),10),'') is null
  and nullif(left(coalesce(d.draft->>'installDate',''),10),'') is not null
on conflict (workspace_id, quote_id) do update set
  start_date = excluded.start_date,
  duration_half_days = excluded.duration_half_days,
  updated_at = now();

insert into public.vf_jobs (workspace_id, quote_id, start_date, duration_half_days)
select
  d.workspace_id,
  d.draft_id as quote_id,
  (
    nullif(left(coalesce(d.draft->>'scheduledAt',''),10),'')::date
  ) as start_date,
  2 as duration_half_days
from public.drafts d
where coalesce(d.draft_id,'') not in ('vf_calendar_blockouts_v1','vf_calendar_tasks_v1')
  and coalesce(d.draft->>'kind','') not in ('calendar_blockouts','calendar_tasks')
  and nullif(left(coalesce(d.draft->>'startDate',''),10),'') is null
  and nullif(left(coalesce(d.draft->>'installDate',''),10),'') is null
  and nullif(left(coalesce(d.draft->>'scheduledAt',''),10),'') is not null
on conflict (workspace_id, quote_id) do update set
  start_date = excluded.start_date,
  duration_half_days = excluded.duration_half_days,
  updated_at = now();

-- 4) Backfill calendar_blockouts from reserved draft doc
insert into public.vf_calendar_blockouts (workspace_id, id, start_date, end_date, description, created_at)
select
  d.workspace_id,
  coalesce(b->>'id','') as id,
  (nullif(left(coalesce(b->>'startIso',''),10),'')::date) as start_date,
  (nullif(left(coalesce(b->>'endIso',''),10),'')::date) as end_date,
  coalesce(b->>'description','') as description,
  now() as created_at
from public.drafts d
cross join lateral jsonb_array_elements(coalesce(d.draft->'blockOuts','[]'::jsonb)) as b
where d.draft_id = 'vf_calendar_blockouts_v1'
  and coalesce(b->>'id','') <> ''
  and nullif(left(coalesce(b->>'startIso',''),10),'') is not null
  and nullif(left(coalesce(b->>'endIso',''),10),'') is not null
on conflict (workspace_id, id) do update set
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  description = excluded.description;

-- 5) Bridge triggers: keep canonical tables updated while app still writes drafts
-- Quotes bridge
create or replace function public.vf_sync_canonical_quotes_from_drafts()
returns trigger
language plpgsql
security definer
as $$
declare
  kind text;
  did text;
begin
  if (tg_op = 'DELETE') then
    delete from public.vf_quotes where workspace_id = old.workspace_id and id = old.draft_id;
    delete from public.vf_jobs where workspace_id = old.workspace_id and quote_id = old.draft_id;
    return old;
  end if;

  kind := coalesce(new.draft->>'kind','');
  did := coalesce(new.draft_id, new.draft->>'id');

  if (coalesce(did,'') in ('vf_calendar_blockouts_v1','vf_calendar_tasks_v1')) then
    return new;
  end if;
  if (kind in ('calendar_blockouts','calendar_tasks')) then
    return new;
  end if;

  insert into public.vf_quotes (
    workspace_id,
    id,
    updated_at,
    status,
    calendar_hidden,
    queue_rank,
    labor_days,
    original_labor_days,
    allow_saturday,
    allow_sunday,
    hold_date,
    estimate_assignee,
    customer_name,
    phone_number,
    project_address,
    title,
    selected_style,
    totals,
    scheduled_at,
    project_photo_url,
    preinstall_count,
    data
  ) values (
    new.workspace_id,
    did,
    coalesce(new.updated_at, now()),
    nullif(new.draft->>'status',''),
    coalesce((new.draft->>'calendarHidden')::boolean,false),
    nullif((new.draft->>'queueRank')::numeric, null),
    nullif((new.draft->>'laborDays')::numeric, null),
    nullif((new.draft->>'originalLaborDays')::numeric, null),
    nullif((new.draft->>'allowSaturday')::boolean, null),
    nullif((new.draft->>'allowSunday')::boolean, null),
    nullif(left(coalesce(new.draft->>'holdDate',''),10),'')::date,
    nullif(new.draft->>'estimateAssignee',''),
    nullif(new.draft->>'customerName',''),
    nullif(new.draft->>'phoneNumber',''),
    nullif(new.draft->>'projectAddress',''),
    nullif(new.draft->>'title',''),
    new.draft->'selectedStyle',
    new.draft->'totals',
    nullif(coalesce(new.draft->>'scheduledAt',''), ''),
    nullif(new.draft->>'projectPhotoUrl',''),
    (
      case
        when jsonb_typeof(new.draft->'preInstallPhotos') = 'array' then jsonb_array_length(new.draft->'preInstallPhotos')
        when coalesce(new.draft->>'preInstallCount','') ~ '^[0-9]+$' then (new.draft->>'preInstallCount')::int
        else null
      end
    ),
    coalesce(new.draft,'{}'::jsonb)
  )
  on conflict (workspace_id, id) do update set
    updated_at = excluded.updated_at,
    status = excluded.status,
    calendar_hidden = excluded.calendar_hidden,
    queue_rank = excluded.queue_rank,
    labor_days = excluded.labor_days,
    original_labor_days = excluded.original_labor_days,
    allow_saturday = excluded.allow_saturday,
    allow_sunday = excluded.allow_sunday,
    hold_date = excluded.hold_date,
    estimate_assignee = excluded.estimate_assignee,
    customer_name = excluded.customer_name,
    phone_number = excluded.phone_number,
    project_address = excluded.project_address,
    title = excluded.title,
    selected_style = excluded.selected_style,
    totals = excluded.totals,
    scheduled_at = excluded.scheduled_at,
    project_photo_url = excluded.project_photo_url,
    preinstall_count = excluded.preinstall_count,
    data = excluded.data;

  -- Jobs bridge: if draft has a schedule date, upsert job; else, delete it.
  if (nullif(left(coalesce(new.draft->>'startDate',''),10),'') is not null) then
    insert into public.vf_jobs (workspace_id, quote_id, start_date, duration_half_days, updated_at)
    values (
      new.workspace_id,
      did,
      nullif(left(coalesce(new.draft->>'startDate',''),10),'')::date,
      greatest(1, ceil(coalesce((new.draft->>'laborDays')::numeric, 1) * 2))::int,
      now()
    )
    on conflict (workspace_id, quote_id) do update set
      start_date = excluded.start_date,
      duration_half_days = excluded.duration_half_days,
      updated_at = excluded.updated_at;
  elsif (nullif(left(coalesce(new.draft->>'installDate',''),10),'') is not null) then
    insert into public.vf_jobs (workspace_id, quote_id, start_date, duration_half_days, updated_at)
    values (
      new.workspace_id,
      did,
      nullif(left(coalesce(new.draft->>'installDate',''),10),'')::date,
      greatest(1, ceil(coalesce((new.draft->>'laborDays')::numeric, 1) * 2))::int,
      now()
    )
    on conflict (workspace_id, quote_id) do update set
      start_date = excluded.start_date,
      duration_half_days = excluded.duration_half_days,
      updated_at = excluded.updated_at;
  elsif (nullif(left(coalesce(new.draft->>'scheduledAt',''),10),'') is not null) then
    insert into public.vf_jobs (workspace_id, quote_id, start_date, duration_half_days, updated_at)
    values (
      new.workspace_id,
      did,
      nullif(left(coalesce(new.draft->>'scheduledAt',''),10),'')::date,
      2,
      now()
    )
    on conflict (workspace_id, quote_id) do update set
      start_date = excluded.start_date,
      duration_half_days = excluded.duration_half_days,
      updated_at = excluded.updated_at;
  else
    delete from public.vf_jobs where workspace_id = new.workspace_id and quote_id = did;
  end if;

  return new;
end;
$$;

drop trigger if exists vf_sync_canonical_quotes_trigger on public.drafts;
create trigger vf_sync_canonical_quotes_trigger
after insert or update or delete on public.drafts
for each row execute procedure public.vf_sync_canonical_quotes_from_drafts();

-- Blockouts bridge: when reserved draft changes, refresh blockouts for that workspace
create or replace function public.vf_sync_canonical_blockouts_from_drafts()
returns trigger
language plpgsql
security definer
as $$
declare
  did text;
begin
  did := coalesce(new.draft_id, new.draft->>'id');
  if (tg_op = 'DELETE') then
    if (coalesce(old.draft_id,'') = 'vf_calendar_blockouts_v1') then
      delete from public.vf_calendar_blockouts where workspace_id = old.workspace_id;
    end if;
    return old;
  end if;

  if (coalesce(did,'') <> 'vf_calendar_blockouts_v1') then
    return new;
  end if;

  delete from public.vf_calendar_blockouts where workspace_id = new.workspace_id;

  insert into public.vf_calendar_blockouts (workspace_id, id, start_date, end_date, description, created_at)
  select
    new.workspace_id,
    coalesce(b->>'id','') as id,
    (nullif(left(coalesce(b->>'startIso',''),10),'')::date) as start_date,
    (nullif(left(coalesce(b->>'endIso',''),10),'')::date) as end_date,
    coalesce(b->>'description','') as description,
    now() as created_at
  from jsonb_array_elements(coalesce(new.draft->'blockOuts','[]'::jsonb)) as b
  where coalesce(b->>'id','') <> ''
    and nullif(left(coalesce(b->>'startIso',''),10),'') is not null
    and nullif(left(coalesce(b->>'endIso',''),10),'') is not null
  on conflict (workspace_id, id) do update set
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    description = excluded.description;

  return new;
end;
$$;

drop trigger if exists vf_sync_canonical_blockouts_trigger on public.drafts;
create trigger vf_sync_canonical_blockouts_trigger
after insert or update or delete on public.drafts
for each row execute procedure public.vf_sync_canonical_blockouts_from_drafts();
