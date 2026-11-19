-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query).

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  instructions text not null default '',
  time_limit_minutes int not null default 10,
  created_at timestamptz not null default now()
);

-- One row per math problem. answer_key is never sent to the browser.
create table if not exists problems (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  position int not null,
  question text not null,
  answer_key text not null,
  unique (assignment_id, position)
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_name text not null,
  paste_count int not null default 0,
  tab_leave_count int not null default 0,
  ai_question_count int not null default 0,
  submitted_at timestamptz not null default now()
);

create table if not exists submission_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  problem_id uuid not null references problems(id) on delete cascade,
  answer text not null,
  is_correct boolean not null
);

-- Full tutor chat log (also our record of prompts/responses for the report)
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  problem_id uuid references problems(id) on delete cascade,
  student_name text,
  role text not null check (role in ('student', 'tutor')),
  content text not null,
  created_at timestamptz not null default now()
);

-- Lock the tables so they can't be read through Supabase's public API.
-- Our Express server uses the secret key, which bypasses these rules.
alter table assignments enable row level security;
alter table problems enable row level security;
alter table submissions enable row level security;
alter table submission_answers enable row level security;
alter table chat_messages enable row level security;
