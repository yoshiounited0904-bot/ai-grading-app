create or replace function public.prevent_profile_protected_column_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    actor_is_admin boolean := false;
begin
    -- Supabase SQL Editor runs as postgres. Browser/client updates do not.
    if session_user = 'postgres' then
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
