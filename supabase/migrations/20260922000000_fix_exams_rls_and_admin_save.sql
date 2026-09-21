-- ==============================================================================
-- exams テーブルの管理者RLSポリシー修復 & 安全なRPC保存関数
-- ==============================================================================

-- 1. 管理者アカウントの profiles.role を 'admin' に確実に更新
UPDATE public.profiles
SET role = 'admin'
WHERE id IN (
  SELECT id FROM auth.users
  WHERE lower(email) IN (
    'yoshiounited0904@gmail.com',
    'se-support@success-edge.net',
    'admin@test.com'
  )
);

-- 2. exams テーブルの RLS ポリシーを is_app_admin() 対応に修復
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can insert exams" ON public.exams;
DROP POLICY IF EXISTS "Admins can update exams" ON public.exams;
DROP POLICY IF EXISTS "Admins can delete exams" ON public.exams;
DROP POLICY IF EXISTS "Anyone can view exams" ON public.exams;

-- 誰でも(未ログイン含む) exams の SELECT が可能
CREATE POLICY "Anyone can view exams" ON public.exams
FOR SELECT
USING (true);

-- 管理者のみが exams の INSERT/UPDATE/DELETE を可能にする
CREATE POLICY "Admins can insert exams" ON public.exams
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_app_admin() OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update exams" ON public.exams
FOR UPDATE
TO authenticated
USING (
  public.is_app_admin() OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  public.is_app_admin() OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can delete exams" ON public.exams
FOR DELETE
TO authenticated
USING (
  public.is_app_admin() OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  )
);

-- 3. 安全に試験データを保存する RPC 関数（SECURITY DEFINER）
-- RLSポリシーの不整合や中間テーブルの権限状態に依存せず、正当な管理者であれば100%確実に保存可能
CREATE OR REPLACE FUNCTION public.admin_save_exam(p_exam jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_res jsonb;
  v_is_admin boolean;
BEGIN
  -- 管理者チェック
  v_is_admin := public.is_app_admin() OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin privileges required to save exam';
  END IF;

  v_id := p_exam->>'id';
  IF v_id IS NULL OR trim(v_id) = '' THEN
    RAISE EXCEPTION 'Exam ID is required';
  END IF;

  INSERT INTO public.exams (
    id,
    university,
    university_id,
    faculty,
    faculty_id,
    year,
    subject,
    subject_en,
    type,
    pdf_path,
    max_score,
    duration_minutes,
    detailed_analysis,
    structure,
    master_status,
    is_published,
    passing_lines,
    custom_layout,
    updated_at
  ) VALUES (
    v_id,
    COALESCE(p_exam->>'university', ''),
    COALESCE((p_exam->>'university_id')::integer, 0),
    COALESCE(p_exam->>'faculty', ''),
    COALESCE(p_exam->>'faculty_id', ''),
    COALESCE((p_exam->>'year')::integer, 2026),
    COALESCE(p_exam->>'subject', ''),
    COALESCE(p_exam->>'subject_en', ''),
    COALESCE(p_exam->>'type', 'pdf'),
    p_exam->>'pdf_path',
    COALESCE((p_exam->>'max_score')::integer, 100),
    COALESCE((p_exam->>'duration_minutes')::integer, 60),
    p_exam->>'detailed_analysis',
    COALESCE(p_exam->'structure', '[]'::jsonb),
    COALESCE(p_exam->>'master_status', 'working'),
    COALESCE((p_exam->>'is_published')::boolean, false),
    COALESCE(p_exam->'passing_lines', '{"A":80,"B":70,"C":60,"D":40}'::jsonb),
    COALESCE(p_exam->'custom_layout', '[]'::jsonb),
    timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    university = EXCLUDED.university,
    university_id = EXCLUDED.university_id,
    faculty = EXCLUDED.faculty,
    faculty_id = EXCLUDED.faculty_id,
    year = EXCLUDED.year,
    subject = EXCLUDED.subject,
    subject_en = EXCLUDED.subject_en,
    type = EXCLUDED.type,
    pdf_path = COALESCE(EXCLUDED.pdf_path, exams.pdf_path),
    max_score = EXCLUDED.max_score,
    duration_minutes = EXCLUDED.duration_minutes,
    detailed_analysis = EXCLUDED.detailed_analysis,
    structure = EXCLUDED.structure,
    master_status = EXCLUDED.master_status,
    is_published = EXCLUDED.is_published,
    passing_lines = EXCLUDED.passing_lines,
    custom_layout = EXCLUDED.custom_layout,
    updated_at = timezone('utc'::text, now());

  SELECT jsonb_build_object('id', v_id, 'updated_at', timezone('utc'::text, now())) INTO v_res;
  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_save_exam(jsonb) TO authenticated;
