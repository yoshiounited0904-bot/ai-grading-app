create table if not exists consultation_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid null references auth.users(id) on delete set null,
    exam_result_id uuid null references exam_results(id) on delete set null,
    exam_id text null,
    student_name text not null,
    grade text null,
    email text null,
    line_display_name text null,
    preferred_method text not null default 'line',
    preferred_time_1 text null,
    preferred_time_2 text null,
    preferred_time_3 text null,
    consultation_message text null,
    university_name text null,
    faculty_name text null,
    exam_subject text null,
    exam_year integer null,
    score numeric null,
    max_score numeric null,
    pass_probability text null,
    weakness_summary text null,
    wrong_question_count integer null,
    chat_summary text null,
    chat_history jsonb null,
    section_focus jsonb null,
    consultation_context jsonb null,
    line_match_code text not null unique,
    line_match_message text not null,
    line_matched boolean not null default false,
    status text not null default 'new',
    admin_memo text null,
    source text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table consultation_requests add column if not exists user_id uuid null references auth.users(id) on delete set null;
alter table consultation_requests add column if not exists exam_result_id uuid null references exam_results(id) on delete set null;
alter table consultation_requests add column if not exists exam_id text null;
alter table consultation_requests add column if not exists student_name text;
alter table consultation_requests add column if not exists grade text null;
alter table consultation_requests add column if not exists email text null;
alter table consultation_requests add column if not exists line_display_name text null;
alter table consultation_requests add column if not exists preferred_method text not null default 'line';
alter table consultation_requests add column if not exists preferred_time_1 text null;
alter table consultation_requests add column if not exists preferred_time_2 text null;
alter table consultation_requests add column if not exists preferred_time_3 text null;
alter table consultation_requests add column if not exists consultation_message text null;
alter table consultation_requests add column if not exists university_name text null;
alter table consultation_requests add column if not exists faculty_name text null;
alter table consultation_requests add column if not exists exam_subject text null;
alter table consultation_requests add column if not exists exam_year integer null;
alter table consultation_requests add column if not exists score numeric null;
alter table consultation_requests add column if not exists max_score numeric null;
alter table consultation_requests add column if not exists pass_probability text null;
alter table consultation_requests add column if not exists weakness_summary text null;
alter table consultation_requests add column if not exists wrong_question_count integer null;
alter table consultation_requests add column if not exists chat_summary text null;
alter table consultation_requests add column if not exists chat_history jsonb null;
alter table consultation_requests add column if not exists section_focus jsonb null;
alter table consultation_requests add column if not exists consultation_context jsonb null;
alter table consultation_requests add column if not exists line_match_code text;
alter table consultation_requests add column if not exists line_match_message text;
alter table consultation_requests add column if not exists line_matched boolean not null default false;
alter table consultation_requests add column if not exists status text not null default 'new';
alter table consultation_requests add column if not exists admin_memo text null;
alter table consultation_requests add column if not exists source text null;
alter table consultation_requests add column if not exists created_at timestamptz not null default now();
alter table consultation_requests add column if not exists updated_at timestamptz not null default now();

update consultation_requests
set student_name = coalesce(nullif(student_name, ''), '未入力')
where student_name is null or student_name = '';

update consultation_requests
set line_match_code = coalesce(nullif(line_match_code, ''), 'SE-' || upper(substr(md5(id::text), 1, 5)))
where line_match_code is null or line_match_code = '';

update consultation_requests
set line_match_message = coalesce(
    nullif(line_match_message, ''),
    '無料カウンセリングを申し込みました。' || chr(10) ||
    '照合コード: ' || line_match_code || chr(10) ||
    '予約名: ' || student_name
)
where line_match_message is null or line_match_message = '';

alter table consultation_requests alter column student_name set not null;
alter table consultation_requests alter column line_match_code set not null;
alter table consultation_requests alter column line_match_message set not null;

create unique index if not exists consultation_requests_line_match_code_key
on consultation_requests(line_match_code);

alter table consultation_requests enable row level security;

drop policy if exists "Users can create consultation requests" on consultation_requests;
create policy "Users can create consultation requests"
on consultation_requests
for insert
to anon, authenticated
with check (true);

drop policy if exists "Users can read own consultation requests" on consultation_requests;
create policy "Users can read own consultation requests"
on consultation_requests
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Admins can read consultation requests" on consultation_requests;
create policy "Admins can read consultation requests"
on consultation_requests
for select
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);

drop policy if exists "Admins can update consultation requests" on consultation_requests;
create policy "Admins can update consultation requests"
on consultation_requests
for update
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
)
with check (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);

drop policy if exists "Admins can delete consultation requests" on consultation_requests;
create policy "Admins can delete consultation requests"
on consultation_requests
for delete
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);

drop policy if exists "Admins can read all exam results" on exam_results;
create policy "Admins can read all exam results"
on exam_results
for select
to authenticated
using (
    exists (
        select 1
        from profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);
