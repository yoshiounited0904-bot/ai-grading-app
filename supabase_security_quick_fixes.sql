-- Quick security hardening for public Data API access.

-- 1. Prevent normal users from updating protected billing/admin columns on their own profile.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS terms_agreed_at timestamptz null;

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_own_update" ON profiles;
CREATE POLICY "Users can update own editable profile fields"
ON profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

REVOKE UPDATE ON profiles FROM anon, authenticated;
GRANT UPDATE (username, first_choice_university, grade, terms_agreed_at)
ON profiles TO authenticated;

-- Keep expected read/create paths available.
GRANT SELECT, INSERT ON profiles TO authenticated;

-- 2. Lock down user feedback visibility. Previously all authenticated users could read/update all feedback.
ALTER TABLE user_feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert feedback" ON user_feedbacks;
DROP POLICY IF EXISTS "Authenticated users can view feedbacks" ON user_feedbacks;
DROP POLICY IF EXISTS "Authenticated users can update feedbacks" ON user_feedbacks;
DROP POLICY IF EXISTS "Admins can view feedbacks" ON user_feedbacks;
DROP POLICY IF EXISTS "Admins can update feedbacks" ON user_feedbacks;
DROP POLICY IF EXISTS "Admins can delete feedbacks" ON user_feedbacks;

CREATE POLICY "Anyone can insert feedback"
ON user_feedbacks
FOR INSERT
TO anon, authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Admins can view feedbacks"
ON user_feedbacks
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
    )
);

CREATE POLICY "Admins can update feedbacks"
ON user_feedbacks
FOR UPDATE
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
ON user_feedbacks
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
    )
);

-- 3. Keep consultation insert public, but prevent user_id spoofing and reduce abuse payload size.
ALTER TABLE consultation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create consultation requests" ON consultation_requests;
CREATE POLICY "Users can create consultation requests"
ON consultation_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

ALTER TABLE consultation_requests DROP CONSTRAINT IF EXISTS consultation_requests_input_size_check;
ALTER TABLE consultation_requests ADD CONSTRAINT consultation_requests_input_size_check
CHECK (
    char_length(coalesce(student_name, '')) <= 80
    AND char_length(coalesce(email, '')) <= 254
    AND char_length(coalesce(line_display_name, '')) <= 80
    AND char_length(coalesce(preferred_time_1, '')) <= 120
    AND char_length(coalesce(preferred_time_2, '')) <= 120
    AND char_length(coalesce(preferred_time_3, '')) <= 120
    AND char_length(coalesce(consultation_message, '')) <= 2000
    AND char_length(coalesce(chat_summary, '')) <= 4000
);

-- 4. Reduce low-effort feedback spam payload size.
ALTER TABLE user_feedbacks DROP CONSTRAINT IF EXISTS user_feedbacks_input_size_check;
ALTER TABLE user_feedbacks ADD CONSTRAINT user_feedbacks_input_size_check
CHECK (
    char_length(coalesce(name, '')) <= 80
    AND char_length(coalesce(email, '')) <= 254
    AND char_length(coalesce(message, '')) BETWEEN 1 AND 4000
);
