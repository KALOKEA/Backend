-- Migration 010: Homepage content key-value store
-- Allows admin to edit all homepage text without code changes.

CREATE TABLE IF NOT EXISTS homepage_content (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default values (idempotent — skipped if key already exists)
INSERT INTO homepage_content (key, value) VALUES
  ('hero_eyebrow',    'NEW COLLECTION — 2026'),
  ('hero_headline_1', 'Dressed for'),
  ('hero_headline_2', 'Every Moment'),
  ('hero_subtext',    'Timeless silhouettes, curated fabrics — pieces that move with you, season after season.'),
  ('hero_cta1_label', 'Shop Collection'),
  ('hero_cta1_link',  '/shop'),
  ('hero_cta2_label', 'New Arrivals'),
  ('hero_cta2_link',  '/shop?tag=new-arrivals'),
  ('hero_image_url',  'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1400&q=90&fit=crop&crop=top'),
  ('hero_video_url',  ''),
  ('hero_mode',       'image')
ON CONFLICT (key) DO NOTHING;

GRANT ALL ON homepage_content TO service_role;
