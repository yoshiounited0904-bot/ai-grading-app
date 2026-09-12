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

DROP POLICY IF EXISTS "Anyone can insert feedback" ON user_feedbacks;
DROP POLICY IF EXISTS "Authenticated users can view feedbacks" ON user_feedbacks;
DROP POLICY IF EXISTS "Authenticated users can update feedbacks" ON user_feedbacks;
DROP POLICY IF EXISTS "Admins can view feedbacks" ON user_feedbacks;
DROP POLICY IF EXISTS "Admins can update feedbacks" ON user_feedbacks;
DROP POLICY IF EXISTS "Admins can delete feedbacks" ON user_feedbacks;

-- 誰でもINSERT可能。ただしログインユーザーIDを詐称できないようにする。
CREATE POLICY "Anyone can insert feedback" 
ON user_feedbacks FOR INSERT 
TO anon, authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- 閲覧・更新・削除は管理者のみ。
CREATE POLICY "Admins can view feedbacks" 
ON user_feedbacks FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
    )
);

CREATE POLICY "Admins can update feedbacks" 
ON user_feedbacks FOR UPDATE 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
    )
);

CREATE POLICY "Admins can delete feedbacks" 
ON user_feedbacks FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
    )
);
