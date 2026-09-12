create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
    or lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'yoshiounited0904@gmail.com',
      'se-support@success-edge.net',
      'admin@test.com'
    ),
    false
  );
$$;

drop policy if exists "Admins can read consultation requests" on public.consultation_requests;
create policy "Admins can read consultation requests"
on public.consultation_requests
for select
to authenticated
using (public.is_app_admin());

drop policy if exists "Admins can update consultation requests" on public.consultation_requests;
create policy "Admins can update consultation requests"
on public.consultation_requests
for update
to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

drop policy if exists "Admins can delete consultation requests" on public.consultation_requests;
create policy "Admins can delete consultation requests"
on public.consultation_requests
for delete
to authenticated
using (public.is_app_admin());

drop policy if exists "Admins can read all exam results" on public.exam_results;
create policy "Admins can read all exam results"
on public.exam_results
for select
to authenticated
using (public.is_app_admin());
