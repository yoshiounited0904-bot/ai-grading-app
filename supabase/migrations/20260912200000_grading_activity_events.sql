-- ==============================================================================
-- リアルタイム採点通知用テーブルとトリガー
-- grading_activity_events
-- ==============================================================================

-- 1. テーブル作成
create table if not exists public.grading_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null default '受験生',
  university text not null,
  faculty text,
  subject text not null,
  year integer,
  score integer not null,
  max_score integer not null,
  exam_id text,
  result_id uuid references public.exam_results(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  is_public boolean not null default true
);

-- 2. インデックス作成
create index if not exists grading_activity_events_public_created_at_idx
on public.grading_activity_events (is_public, created_at desc);

-- 3. RLS（Row Level Security）有効化
alter table public.grading_activity_events enable row level security;

-- 権限付与
grant select on public.grading_activity_events to anon, authenticated;

-- 全員（匿名・ログイン済み）が公開イベントを読み取り可能
drop policy if exists "Anyone can read public grading activity events" on public.grading_activity_events;
create policy "Anyone can read public grading activity events"
on public.grading_activity_events
for select
to anon, authenticated
using (is_public = true);

-- 4. 採点結果（exam_results）insert 時の自動イベント生成トリガー関数
create or replace function public.create_grading_activity_event_from_exam_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_role text;
  profile_username text;
  user_email text;
  clean_university text;
  clean_subject text;
  final_display_name text;
begin
  -- スコアが不正（null、max_score が 0 以下、score が負数）なら除外
  if new.score is null or new.max_score is null or new.max_score <= 0 or new.score < 0 then
    return new;
  end if;

  -- 大学名・科目が空なら除外
  clean_university := nullif(trim(coalesce(new.university_name, '')), '');
  clean_subject := nullif(trim(coalesce(new.exam_subject, '')), '');
  if clean_university is null or clean_subject is null then
    return new;
  end if;

  -- ユーザー情報の取得（profiles）
  select role, username
    into profile_role, profile_username
    from public.profiles
    where id = new.user_id;

  -- 認証メールアドレスの取得（auth.users）
  select email
    into user_email
    from auth.users
    where id = new.user_id;

  -- admin 権限ユーザーの採点は除外
  if coalesce(profile_role, 'user') = 'admin' then
    return new;
  end if;

  -- 管理者・テストメールアドレスの採点は除外
  if coalesce(user_email, '') in ('admin@test.com', 'yoshiounited0904@gmail.com') then
    return new;
  end if;

  -- テストユーザー（username に test, admin, 管理, mock を含む）は除外
  if coalesce(profile_username, '') ~* '(test|admin|管理|mock)' then
    return new;
  end if;

  -- 表示名のフォーマット
  -- 空文字またはメールアドレス形式（@を含む）の場合は「受験生」にフォールバック
  if trim(coalesce(profile_username, '')) = '' or profile_username like '%@%' then
    final_display_name := '受験生';
  else
    final_display_name := left(trim(profile_username), 15);
  end if;

  -- イベントの挿入
  insert into public.grading_activity_events (
    user_id,
    display_name,
    university,
    faculty,
    subject,
    year,
    score,
    max_score,
    exam_id,
    result_id,
    created_at,
    is_public
  )
  values (
    new.user_id,
    final_display_name,
    clean_university,
    nullif(trim(coalesce(new.faculty_name, '')), ''),
    clean_subject,
    new.exam_year,
    floor(new.score)::integer,
    floor(new.max_score)::integer,
    nullif(trim(coalesce(new.pdf_path, '')), ''),
    new.id,
    coalesce(new.created_at, timezone('utc'::text, now())),
    true
  );

  return new;
end;
$$;

-- 関数の実行権限保護
revoke all on function public.create_grading_activity_event_from_exam_result() from public;
revoke all on function public.create_grading_activity_event_from_exam_result() from anon;
revoke all on function public.create_grading_activity_event_from_exam_result() from authenticated;

-- 5. トリガー設定
drop trigger if exists create_grading_activity_event_after_exam_result_insert on public.exam_results;
create trigger create_grading_activity_event_after_exam_result_insert
after insert on public.exam_results
for each row
execute function public.create_grading_activity_event_from_exam_result();

-- 6. Supabase Realtime 有効化
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'grading_activity_events'
  ) then
    alter publication supabase_realtime add table public.grading_activity_events;
  end if;
exception
  when others then
    -- publication が存在しない開発環境などの例外を吸収
    null;
end;
$$;

-- 7. 直近の有効な採点結果から初期データを生成（すでに採点ログがある場合）
insert into public.grading_activity_events (
  user_id,
  display_name,
  university,
  faculty,
  subject,
  year,
  score,
  max_score,
  result_id,
  created_at,
  is_public
)
select
  er.user_id,
  case
    when trim(coalesce(p.username, '')) = '' or p.username like '%@%' then '受験生'
    else left(trim(p.username), 15)
  end as display_name,
  er.university_name,
  nullif(trim(coalesce(er.faculty_name, '')), ''),
  er.exam_subject,
  er.exam_year,
  floor(er.score)::integer,
  floor(er.max_score)::integer,
  er.id,
  er.created_at,
  true
from public.exam_results er
left join public.profiles p on p.id = er.user_id
where er.score is not null
  and er.max_score is not null
  and er.max_score > 0
  and er.score >= 0
  and nullif(trim(coalesce(er.university_name, '')), '') is not null
  and nullif(trim(coalesce(er.exam_subject, '')), '') is not null
  and coalesce(p.role, 'user') != 'admin'
  and not (coalesce(p.username, '') ~* '(test|admin|管理|mock)')
  and not exists (
    select 1 from public.grading_activity_events gae where gae.result_id = er.id
  )
order by er.created_at desc
limit 10;
