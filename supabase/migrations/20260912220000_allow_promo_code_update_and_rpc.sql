-- ==============================================================================
-- プロモコードおよび認知経路アンケートの profiles 更新権限付与 & 安全なRPC関数
-- ==============================================================================

-- 1. profiles テーブルに対する更新権限の付与（プロモコード・アンケート用カラムを含む）
GRANT UPDATE (
    username,
    first_choice_university,
    grade,
    terms_agreed_at,
    referral_source,
    promo_code_verified,
    promo_code_verified_at,
    promo_code_value
) ON public.profiles TO authenticated;

-- 2. プロモコード確認用 RPC（SECURITY DEFINER で安全・確実に実行）
CREATE OR REPLACE FUNCTION public.verify_user_promo_code(p_promo_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
  SET 
    promo_code_verified = true,
    promo_code_verified_at = timezone('utc'::text, now()),
    promo_code_value = upper(trim(p_promo_code))
  WHERE id = auth.uid();

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_user_promo_code(text) TO authenticated;
