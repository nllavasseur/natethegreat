create table if not exists public.job_tasks (
  workspace_id uuid not null,
  draft_id text not null,
  updated_at timestamptz not null default now(),
  job_tasks jsonb null,
  job_task_snooze jsonb null,
  primary key (workspace_id, draft_id)
);

alter table public.job_tasks add column if not exists job_task_labels jsonb null;
alter table public.job_tasks add column if not exists job_task_hidden jsonb null;
alter table public.job_tasks add column if not exists job_custom_tasks jsonb null;

create index if not exists job_tasks_workspace_updated_idx
  on public.job_tasks (workspace_id, updated_at);
