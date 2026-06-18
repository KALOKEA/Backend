-- Migration 036: guarantee content/value columns are UNBOUNDED text.
--
-- Symptom: admin can only save a limited amount of content on some pages
-- (e.g. 22 Terms points but only ~8 persist). The code path has no length cap
-- (TEXT in the migrations, no @MaxLength validator, default 100kb body limit,
-- no editor maxLength). The remaining possible cause is a legacy column that is
-- actually varchar(N) in the live database (a CREATE TABLE IF NOT EXISTS never
-- converts an already-existing column). Forcing TYPE TEXT removes any such cap.
--
-- Safe + idempotent: converting an already-TEXT column to TEXT is a no-op.

ALTER TABLE cms_pages       ALTER COLUMN content          TYPE TEXT;
ALTER TABLE cms_pages       ALTER COLUMN meta_description TYPE TEXT;
ALTER TABLE homepage_content ALTER COLUMN value           TYPE TEXT;
ALTER TABLE site_content     ALTER COLUMN value           TYPE TEXT;

NOTIFY pgrst, 'reload schema';

-- Diagnostic (run separately to SEE the current types):
-- SELECT table_name, column_name, data_type, character_maximum_length
-- FROM information_schema.columns
-- WHERE table_name IN ('cms_pages','homepage_content','site_content')
--   AND column_name IN ('content','value','meta_description');
