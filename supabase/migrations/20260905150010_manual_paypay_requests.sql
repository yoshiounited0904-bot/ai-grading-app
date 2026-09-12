create table if not exists public.manual_paypay_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    email text not null,
    line_display_name text null,
    pass_id text not null,
    pass_label text not null,
    pass_days integer not null check (pass_days > 0 and pass_days <= 370),
    amount_label text null,
    line_match_code text not null unique,
    line_match_message text not null,
    status text not null default 'new'
        check (status in ('new', 'waiting_payment', 'paid', 'activated', 'cancelled')),
    admin_memo text null,
    activated_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.manual_paypay_requests enable row level security;

drop policy if exists "Users can create own manual PayPay requests" on public.manual_paypay_requests;
create policy "Users can create own manual PayPay requests"
on public.manual_paypay_requests
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own manual PayPay requests" on public.manual_paypay_requests;
create policy "Users can read own manual PayPay requests"
on public.manual_paypay_requests
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Admins can read manual PayPay requests" on public.manual_paypay_requests;
create policy "Admins can read manual PayPay requests"
on public.manual_paypay_requests
for select
to authenticated
using (
    exists (
        select 1
        from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.role = 'admin'
    )
);

drop policy if exists "Admins can update manual PayPay requests" on public.manual_paypay_requests;
create policy "Admins can update manual PayPay requests"
on public.manual_paypay_requests
for update
to authenticated
using (
    exists (
        select 1
        from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.role = 'admin'
    )
)
with check (
    exists (
        select 1
        from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.role = 'admin'
    )
);

drop policy if exists "Admins can manage premium profiles" on public.profiles;
create policy "Admins can manage premium profiles"
on public.profiles
for update
to authenticated
using (
    exists (
        select 1
        from public.profiles admin_profile
        where admin_profile.id = (select auth.uid())
          and admin_profile.role = 'admin'
    )
)
with check (
    exists (
        select 1
        from public.profiles admin_profile
        where admin_profile.id = (select auth.uid())
          and admin_profile.role = 'admin'
    )
);
