-- 管理者向けメモ（コメント）機能を追加
ALTER TABLE exam_master ADD COLUMN IF NOT EXISTS admin_comment TEXT;

-- インデックス作成（オプション: 検索性を高める場合）
-- CREATE INDEX IF NOT EXISTS idx_exam_master_admin_comment ON exam_master (admin_comment);
