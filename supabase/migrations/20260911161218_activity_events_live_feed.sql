create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null default 'exam_graded',
  anonymous_label text not null default '受験生',
  university_name text,
  faculty_name text,
  exam_subject text,
  exam_year integer,
  score integer,
  max_score integer,
  pass_probability text,
  is_public boolean not null default true,
  source_result_id uuid references public.exam_results(id) on delete set null,
  result_created_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists activity_events_public_created_at_idx
on public.activity_events (is_public, created_at desc);

alter table public.activity_events enable row level security;

grant select on public.activity_events to anon, authenticated;

drop policy if exists "Anyone can read public activity events" on public.activity_events;
create policy "Anyone can read public activity events"
on public.activity_events
for select
to anon, authenticated
using (is_public = true);

create or replace function public.create_activity_event_from_exam_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_role text;
  profile_username text;
  event_university text;
  event_subject text;
begin
  select role, username
    into profile_role, profile_username
    from public.profiles
    where id = new.user_id;

  if coalesce(profile_role, 'user') = 'admin' then
    return new;
  end if;

  if coalesce(profile_username, '') ~* '(test|admin|管理|mock)' then
    return new;
  end if;

  event_university := nullif(trim(coalesce(new.university_name, '')), '');
  event_subject := nullif(trim(coalesce(new.exam_subject, '')), '');

  if event_university is null or event_subject is null then
    return new;
  end if;

  insert into public.activity_events (
    event_type,
    anonymous_label,
    university_name,
    faculty_name,
    exam_subject,
    exam_year,
    score,
    max_score,
    pass_probability,
    source_result_id,
    result_created_at,
    is_public
  )
  values (
    'exam_graded',
    case
      when trim(coalesce(profile_username, '')) = '' then '受験生'
      when profile_username like '%@%' then '受験生'
      else left(trim(profile_username), 24)
    end,
    event_university,
    nullif(trim(coalesce(new.faculty_name, '')), ''),
    event_subject,
    new.exam_year,
    new.score,
    new.max_score,
    nullif(trim(coalesce(new.pass_probability, '')), ''),
    new.id,
    new.created_at,
    true
  );

  return new;
end;
$$;

revoke all on function public.create_activity_event_from_exam_result() from public;
revoke all on function public.create_activity_event_from_exam_result() from anon;
revoke all on function public.create_activity_event_from_exam_result() from authenticated;

drop trigger if exists create_activity_event_after_exam_result_insert on public.exam_results;
create trigger create_activity_event_after_exam_result_insert
after insert on public.exam_results
for each row
execute function public.create_activity_event_from_exam_result();
