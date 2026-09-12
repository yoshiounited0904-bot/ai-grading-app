-- 1. Create the banner_ads table
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS banner_ads (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  target_url TEXT,
  is_active BOOLEAN DEFAULT false,
  start_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  end_at TIMESTAMP WITH TIME ZONE,
  layout_type TEXT CHECK (layout_type IN ('horizontal', 'square', 'text')) DEFAULT 'horizontal',
  page_target TEXT DEFAULT 'all',  -- 'home', 'exam', 'result', etc.
  width_percent INT DEFAULT 100,
  click_count INT DEFAULT 0,
  impression_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Existing projects can run this file again safely.
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS slot TEXT DEFAULT 'all';
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS slots TEXT[] DEFAULT ARRAY['all'];
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS target_audience TEXT DEFAULT 'all';
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS priority INT DEFAULT 50;
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS width_percent INT DEFAULT 100;
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT '詳しく見る';
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS university TEXT;
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS faculty TEXT;
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS year INT;
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE banner_ads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

UPDATE banner_ads
SET slots = ARRAY[COALESCE(NULLIF(slot, ''), 'all')]
WHERE slots IS NULL OR array_length(slots, 1) IS NULL;

UPDATE banner_ads
SET width_percent = 100
WHERE width_percent IS NULL;

CREATE INDEX IF NOT EXISTS idx_banner_ads_active_slot ON banner_ads (is_active, slot, priority DESC);
CREATE INDEX IF NOT EXISTS idx_banner_ads_slots ON banner_ads USING GIN (slots);
CREATE INDEX IF NOT EXISTS idx_banner_ads_page_target ON banner_ads (page_target);
CREATE INDEX IF NOT EXISTS idx_banner_ads_targeting ON banner_ads (target_audience, university, faculty, subject, year);
CREATE INDEX IF NOT EXISTS idx_banner_ads_active_window ON banner_ads (is_active, start_at, end_at);

ALTER TABLE banner_ads DROP CONSTRAINT IF EXISTS banner_ads_width_percent_range;
ALTER TABLE banner_ads ADD CONSTRAINT banner_ads_width_percent_range CHECK (width_percent BETWEEN 30 AND 100);

-- 2. Create a bucket for banner images in Supabase Storage (if not exists)
-- Note: This part usually needs to be done via the UI or a separate script, 
-- but you can try to run this in the SQL Editor.
-- INSERT INTO storage.buckets (id, name, public) VALUES ('banners', 'banners', true) ON CONFLICT (id) DO NOTHING;

-- 3. RLS (Row Level Security)
ALTER TABLE banner_ads ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read active ads
DROP POLICY IF EXISTS "Allow public read for active ads" ON banner_ads;
CREATE POLICY "Allow public read for active ads" ON banner_ads
  FOR SELECT USING (
    is_active = true
    AND (start_at IS NULL OR start_at <= now())
    AND (end_at IS NULL OR end_at > now())
  );

-- Allow admins full access (Assumes an 'admin' role or similar metadata in auth.users)
-- Adjust the USING/WITH CHECK to match your auth structure.
DROP POLICY IF EXISTS "Allow admin all" ON banner_ads;
CREATE POLICY "Allow admin all" ON banner_ads
  FOR ALL USING (auth.jwt() ->> 'email' = 'yoshitaka0904.cloud@gmail.com') -- Adjust to your admin email
  WITH CHECK (auth.jwt() ->> 'email' = 'yoshitaka0904.cloud@gmail.com');

-- 4. RPC for Atomic Increments
CREATE OR REPLACE FUNCTION increment_banner_click(banner_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE banner_ads
  SET click_count = click_count + 1
  WHERE id = banner_id
    AND is_active = true
    AND (start_at IS NULL OR start_at <= now())
    AND (end_at IS NULL OR end_at > now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION increment_banner_impressions(banner_ids UUID[])
RETURNS VOID AS $$
BEGIN
  UPDATE banner_ads
  SET impression_count = impression_count + 1
  WHERE id = ANY(banner_ids)
    AND is_active = true
    AND (start_at IS NULL OR start_at <= now())
    AND (end_at IS NULL OR end_at > now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION increment_banner_click(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_banner_impressions(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_banner_click(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_banner_impressions(UUID[]) TO anon, authenticated;
