alter table public.profiles
add column if not exists promo_code_verified boolean not null default false,
add column if not exists promo_code_verified_at timestamptz,
add column if not exists promo_code_value text;
