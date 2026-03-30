-- 1. Create the banner_ads table
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
  click_count INT DEFAULT 0,
  impression_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Create a bucket for banner images in Supabase Storage (if not exists)
-- Note: This part usually needs to be done via the UI or a separate script, 
-- but you can try to run this in the SQL Editor.
-- INSERT INTO storage.buckets (id, name, public) VALUES ('banners', 'banners', true) ON CONFLICT (id) DO NOTHING;

-- 3. RLS (Row Level Security)
ALTER TABLE banner_ads ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read active ads
CREATE POLICY "Allow public read for active ads" ON banner_ads
  FOR SELECT USING (is_active = true AND (end_at IS NULL OR end_at > now()));

-- Allow admins full access (Assumes an 'admin' role or similar metadata in auth.users)
-- Adjust the USING/WITH CHECK to match your auth structure.
CREATE POLICY "Allow admin all" ON banner_ads
  FOR ALL USING (auth.jwt() ->> 'email' = 'yoshitaka0904.cloud@gmail.com') -- Adjust to your admin email
  WITH CHECK (auth.jwt() ->> 'email' = 'yoshitaka0904.cloud@gmail.com');

-- 4. RPC for Atomic Increments
CREATE OR REPLACE FUNCTION increment_banner_click(banner_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE banner_ads
  SET click_count = click_count + 1
  WHERE id = banner_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
