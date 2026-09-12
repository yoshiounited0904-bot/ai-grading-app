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

do $$
begin
  if to_regclass('public.activity_events') is not null then
    update public.activity_events ae
    set is_public = false
    from public.exam_results er
    join public.profiles p on p.id = er.user_id
    where ae.source_result_id = er.id
      and coalesce(p.role, 'user') = 'admin';
  end if;
end;
$$;
