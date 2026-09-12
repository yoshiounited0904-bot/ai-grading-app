-- Stripe subscription billing for premium plan.
-- This migration also prevents browser clients from granting themselves premium/admin access.

alter table public.profiles
add column if not exists plan text not null default 'free';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'profiles_plan_check'
    ) then
        alter table public.profiles
        add constraint profiles_plan_check
        check (plan in ('free', 'premium', 'consultation', 'admin'));
    end if;
end $$;

alter table public.profiles
add column if not exists stripe_customer_id text null;

alter table public.profiles
add column if not exists stripe_subscription_id text null;

alter table public.profiles
add column if not exists subscription_status text null;

alter table public.profiles
add column if not exists premium_until timestamptz null;

create unique index if not exists profiles_stripe_customer_id_idx
on public.profiles(stripe_customer_id)
where stripe_customer_id is not null;

create unique index if not exists profiles_stripe_subscription_id_idx
on public.profiles(stripe_subscription_id)
where stripe_subscription_id is not null;

create or replace function public.prevent_profile_protected_column_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    jwt_role text := coalesce(
        current_setting('request.jwt.claim.role', true),
        current_setting('role', true),
        ''
    );
    actor_is_admin boolean := false;
begin
    if jwt_role = 'service_role' then
        return new;
    end if;

    select exists (
        select 1
        from public.profiles
        where id = auth.uid()
          and role = 'admin'
    )
    into actor_is_admin;

    if actor_is_admin then
        return new;
    end if;

    if new.role is distinct from old.role
        or new.plan is distinct from old.plan
        or new.stripe_customer_id is distinct from old.stripe_customer_id
        or new.stripe_subscription_id is distinct from old.stripe_subscription_id
        or new.subscription_status is distinct from old.subscription_status
        or new.premium_until is distinct from old.premium_until
    then
        raise exception 'Protected billing/profile fields cannot be updated by clients';
    end if;

    return new;
end;
$$;

drop trigger if exists prevent_profile_protected_column_updates on public.profiles;
create trigger prevent_profile_protected_column_updates
before update on public.profiles
for each row
execute function public.prevent_profile_protected_column_updates();

create table if not exists public.payment_events (
    id text primary key,
    type text not null,
    status text not null default 'processing'
        check (status in ('processing', 'processed', 'failed')),
    processed_at timestamptz not null default now(),
    error text null,
    payload jsonb null
);

alter table public.payment_events
add column if not exists status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed'));

alter table public.payment_events
add column if not exists error text null;

alter table public.payment_events enable row level security;

drop policy if exists "Admins can read payment events" on public.payment_events;
create policy "Admins can read payment events"
on public.payment_events
for select
to authenticated
using (
    exists (
        select 1
        from public.profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
    )
);
