create table if not exists public.job_tasks (
  workspace_id uuid not null,
  draft_id text not null,
  updated_at timestamptz not null default now(),
  job_tasks jsonb null,
  job_task_snooze jsonb null,
  primary key (workspace_id, draft_id)
);

create index if not exists job_tasks_workspace_updated_idx
  on public.job_tasks (workspace_id, updated_at);
