-- ==============================================================================
-- 管理者が exam_results および profiles を閲覧できるようにする RLS ポリシー設定
-- ==============================================================================

-- 1. カラムが存在しない場合に備えて追加（安全策）
alter table public.exam_results add column if not exists faculty_name text;
alter table public.exam_results add column if not exists pdf_path text;

-- 2. 管理者判定関数の作成 / 更新
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'yoshiounited0904@gmail.com',
      'se-support@success-edge.net',
      'admin@test.com'
    )
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    ),
    false
  );
$$;

-- 3. profiles テーブルに対する管理者の SELECT ポリシー
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_app_admin());

-- 4. exam_results テーブルに対する管理者の SELECT ポリシー
drop policy if exists "Admins can read all exam results" on public.exam_results;
create policy "Admins can read all exam results"
on public.exam_results
for select
to authenticated
using (public.is_app_admin());

-- 5. テーブルの SELECT 権限を authenticated ロールに付与（念のため）
grant select on public.profiles to authenticated;
grant select on public.exam_results to authenticated;
