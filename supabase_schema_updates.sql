-- 未実装項目の管理機能を追加
ALTER TABLE exams ADD COLUMN IF NOT EXISTS unimplemented_items TEXT[] DEFAULT '{}';

-- 制限時間の管理機能を追加
ALTER TABLE exams ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 60;
