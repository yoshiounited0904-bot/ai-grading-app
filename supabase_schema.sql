-- 1. Profiles table (ユーザー情報)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    username TEXT,
    first_choice_university TEXT,
    grade TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. Exam Results table (試験結果)
CREATE TABLE IF NOT EXISTS exam_results (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE,
    university_name TEXT NOT NULL,
    exam_subject TEXT NOT NULL,
    exam_year INTEGER DEFAULT 2025,
    score INTEGER NOT NULL,
    max_score INTEGER NOT NULL,
    pass_probability TEXT,
    weakness_analysis TEXT,
    question_feedback JSONB,
    answers JSONB,
    section_scores JSONB, -- 大問別得点
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. Grading Reports table (採点ミス報告)
CREATE TABLE IF NOT EXISTS grading_reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE,
    university_name TEXT NOT NULL,
    exam_subject TEXT NOT NULL,
    question_id TEXT NOT NULL,
    user_answer TEXT,
    correct_answer TEXT,
    ai_explanation TEXT,
    user_comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- RLS (Row Level Security) の設定
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_reports ENABLE ROW LEVEL SECURITY;

-- 自分のデータのみアクセス可能にするポリシー
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view own results" ON exam_results FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own results" ON exam_results FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own reports" ON grading_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reports" ON grading_reports FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 4. Exams table (マスターデータ)
CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    university TEXT NOT NULL,
    university_id INTEGER NOT NULL,
    faculty TEXT NOT NULL,
    faculty_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    subject TEXT NOT NULL,
    subject_en TEXT NOT NULL,
    type TEXT NOT NULL,
    pdf_path TEXT,
    max_score INTEGER NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    detailed_analysis TEXT,
    structure JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Profiles table に role 列を追加 (すでに存在する場合はスキップ)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- Exams テーブルの RLS を有効化
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;

-- 誰でも(未ログイン含む) exams の SELECT が可能
CREATE POLICY "Anyone can view exams" ON exams FOR SELECT USING (true);

-- 管理者のみが exams の INSERT/UPDATE/DELETE を可能にする
CREATE POLICY "Admins can insert exams" ON exams FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update exams" ON exams FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can delete exams" ON exams FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ============================================
-- STORAGE BUCKET CONFIGURATION
-- ============================================

-- Create a bucket for exam PDFs
INSERT INTO storage.buckets (id, name, public) 
VALUES ('exam-pdfs', 'exam-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for 'exam-pdfs' bucket
CREATE POLICY "Anyone can view exam PDFs"
ON storage.objects FOR SELECT
USING ( bucket_id = 'exam-pdfs' );

CREATE POLICY "Admins can upload exam PDFs"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'exam-pdfs' AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Admins can update exam PDFs"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'exam-pdfs' AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Admins can delete exam PDFs"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'exam-pdfs' AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
