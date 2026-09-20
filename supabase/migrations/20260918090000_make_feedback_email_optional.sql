do $$
begin
  if to_regclass('public.user_feedbacks') is not null then
    alter table public.user_feedbacks
      alter column email drop not null;

    alter table public.user_feedbacks
      alter column name drop not null;
  end if;
end $$;
