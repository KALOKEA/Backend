-- ───────────────────────────────────────────────────────────────────────────
-- 044 — Blog / Journal CMS
--
-- Makes the storefront "Journal" fully editable from the admin panel. Posts
-- were previously hard-coded in the frontend; this table is the new source of
-- truth. The storefront fetches published posts (at build time for the static
-- export) and the admin panel performs full CRUD.
--
-- Idempotent: safe to run multiple times.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blog_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,                 -- SEO <title> + card title
  heading         text,                          -- on-page H1 (defaults to title)
  heading_italic  text,                          -- italic tail of the H1 (editorial style)
  eyebrow         text,                          -- small category/eyebrow label
  excerpt         text,                          -- card / list excerpt
  description     text,                          -- meta description
  content         text,                          -- article body (HTML)
  cover_image     text,                          -- hero / cover image URL (Cloudinary)
  keywords        jsonb NOT NULL DEFAULT '[]'::jsonb, -- SEO keyword targets
  reading_time    text,                          -- e.g. "8 min read"
  author          text,                          -- byline (optional)
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published')),
  published_at    timestamptz,                   -- set when first published
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published
  ON blog_posts (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug
  ON blog_posts (slug);

-- RLS: enable; service_role (used by the API) bypasses it.
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON blog_posts TO service_role;

-- Keep updated_at fresh on every UPDATE (matches the pattern used elsewhere).
DROP TRIGGER IF EXISTS trg_blog_posts_updated_at ON blog_posts;

CREATE OR REPLACE FUNCTION set_blog_posts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION set_blog_posts_updated_at();
