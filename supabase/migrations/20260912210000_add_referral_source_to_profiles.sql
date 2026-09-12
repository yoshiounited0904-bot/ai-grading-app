-- profiles テーブルに認知経路アンケート用カラムを追加
alter table public.profiles
add column if not exists referral_source text;
