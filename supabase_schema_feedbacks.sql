-- ユーザーからのお問い合わせ・バグ報告・要望を管理するテーブル
CREATE TABLE IF NOT EXISTS user_feedbacks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users ON DELETE SET NULL,
    name TEXT,
    email TEXT,
    type TEXT NOT NULL, -- 'bug', 'feature_request', 'inquiry'
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new', -- 'new', 'in_progress', 'resolved'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS
ALTER TABLE user_feedbacks ENABLE ROW LEVEL SECURITY;

-- 誰でもINSERT可能
CREATE POLICY "Anyone can insert feedback" 
ON user_feedbacks FOR INSERT 
WITH CHECK (true);

-- ログイン済みのユーザーならSELECT可能（アプリ側で管理者画面にのみ表示するよう制御）
CREATE POLICY "Authenticated users can view feedbacks" 
ON user_feedbacks FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update feedbacks" 
ON user_feedbacks FOR UPDATE 
USING (auth.role() = 'authenticated');
