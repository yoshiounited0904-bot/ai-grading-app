create table if not exists grading_usage_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    exam_id text null,
    source text not null default 'exam_submit',
    created_at timestamptz not null default now()
);

alter table profiles
add column if not exists plan text not null default 'free';

alter table profiles
add column if not exists premium_until timestamptz null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'profiles_plan_check'
    ) then
        alter table profiles
        add constraint profiles_plan_check
        check (plan in ('free', 'premium', 'consultation', 'admin'));
    end if;
end $$;

alter table grading_usage_logs enable row level security;

create index if not exists grading_usage_logs_user_created_idx
on grading_usage_logs(user_id, created_at desc);

drop policy if exists "Users can read own grading usage" on grading_usage_logs;
create policy "Users can read own grading usage"
on grading_usage_logs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Admins can read grading usage" on grading_usage_logs;
create policy "Admins can read grading usage"
on grading_usage_logs
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

create or replace function public.get_grading_usage_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    month_start timestamptz := date_trunc('month', now());
    used_count integer := 0;
    monthly_limit integer := 3;
    has_consultation boolean := false;
    is_admin boolean := false;
    profile_plan text := 'free';
    has_active_premium boolean := false;
begin
    if current_user_id is null then
        return jsonb_build_object(
            'allowed', false,
            'reason', 'unauthenticated',
            'used', 0,
            'limit', 0,
            'remaining', 0,
            'plan', 'guest'
        );
    end if;

    select
        coalesce(role = 'admin', false),
        coalesce(plan, 'free'),
        coalesce(premium_until > now(), false)
    from profiles
    where id = current_user_id
    into is_admin, profile_plan, has_active_premium;

    if is_admin then
        return jsonb_build_object(
            'allowed', true,
            'used', 0,
            'limit', null,
            'remaining', 999,
            'plan', 'admin'
        );
    end if;

    if profile_plan = 'premium' or has_active_premium then
        return jsonb_build_object(
            'allowed', true,
            'used', 0,
            'limit', null,
            'remaining', null,
            'plan', 'premium'
        );
    end if;

    select exists (
        select 1
        from consultation_requests
        where user_id = current_user_id
          and status is distinct from 'cancelled'
    ) into has_consultation;

    if has_consultation then
        monthly_limit := 7;
    end if;

    select count(*)::integer
    from grading_usage_logs
    where user_id = current_user_id
      and created_at >= month_start
    into used_count;

    return jsonb_build_object(
        'allowed', used_count < monthly_limit,
        'used', used_count,
        'limit', monthly_limit,
        'remaining', greatest(monthly_limit - used_count, 0),
        'plan', case when has_consultation then 'consultation' else coalesce(profile_plan, 'free') end
    );
end;
$$;

create or replace function public.consume_grading_usage(p_exam_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    status jsonb;
    next_used integer;
begin
    if current_user_id is null then
        return jsonb_build_object(
            'allowed', false,
            'reason', 'unauthenticated',
            'used', 0,
            'limit', 0,
            'remaining', 0,
            'plan', 'guest'
        );
    end if;

    status := public.get_grading_usage_status();

    if coalesce((status->>'plan') in ('admin', 'premium'), false) then
        return status;
    end if;

    if not coalesce((status->>'allowed')::boolean, false) then
        return status || jsonb_build_object('reason', 'limit_reached');
    end if;

    insert into grading_usage_logs(user_id, exam_id, source)
    values (current_user_id, p_exam_id, 'exam_submit');

    next_used := coalesce((status->>'used')::integer, 0) + 1;

    return status
        || jsonb_build_object(
            'allowed', true,
            'used', next_used,
            'remaining', greatest(coalesce((status->>'limit')::integer, 0) - next_used, 0)
        );
end;
$$;

grant execute on function public.get_grading_usage_status() to authenticated;
grant execute on function public.consume_grading_usage(text) to authenticated;
