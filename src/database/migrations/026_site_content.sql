-- Migration 026: Site content key-value store
-- Stores About page + Footer column content editable from admin panel.
-- Same pattern as homepage_content (TEXT key-value with upsert).

CREATE TABLE IF NOT EXISTS site_content (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- About: hero section
INSERT INTO site_content (key, value) VALUES
  ('about_hero', '{"eyebrow":"Our Story","headline":"Fashion That","headline_italic":"Tells Your Story","subtext":"KALOKEA was born from a simple belief: every Indian woman deserves fashion that is both beautiful and accessible. We blend global trends with local sensibilities to create pieces that feel both timeless and distinctly yours.","image_url":""}')
ON CONFLICT (key) DO NOTHING;

-- About: values (array of {title, desc})
INSERT INTO site_content (key, value) VALUES
  ('about_values', '[{"title":"Inclusive Beauty","desc":"We design for every body, every skin tone, every occasion. Fashion has no one-size-fits-all formula."},{"title":"Ethical Sourcing","desc":"Our fabrics are sourced from certified mills. Our artisans are paid fair wages. We believe fashion can be both beautiful and responsible."},{"title":"Sustainable Future","desc":"Packaging made from recycled materials. Carbon-neutral shipping by 2026. Fashion that respects the planet."}]')
ON CONFLICT (key) DO NOTHING;

-- About: stats strip (array of {num, label})
INSERT INTO site_content (key, value) VALUES
  ('about_stats', '[{"num":"50K+","label":"Happy Customers"},{"num":"500+","label":"Styles Available"},{"num":"4.8★","label":"Average Rating"},{"num":"28","label":"States Delivered"}]')
ON CONFLICT (key) DO NOTHING;

-- About: team members (array of {name, role, bio, image})
-- Empty by default — admin adds real team members from admin panel
INSERT INTO site_content (key, value) VALUES
  ('about_team', '[]')
ON CONFLICT (key) DO NOTHING;

-- Footer: Shop column links
INSERT INTO site_content (key, value) VALUES
  ('footer_shop_col', '[{"label":"New Arrivals","href":"/shop/new-arrivals/"},{"label":"Dresses","href":"/shop/dresses/"},{"label":"Tops & Blouses","href":"/shop/tops/"},{"label":"Skirts & Pants","href":"/shop/bottoms/"},{"label":"Shoes","href":"/shop/shoes/"},{"label":"Bags","href":"/shop/bags/"},{"label":"Accessories","href":"/shop/accessories/"},{"label":"Sale","href":"/shop/sale/"}]')
ON CONFLICT (key) DO NOTHING;

-- Footer: Help column links
INSERT INTO site_content (key, value) VALUES
  ('footer_help_col', '[{"label":"Contact Us","href":"/contact/"},{"label":"Size Guide","href":"/size-guide/"},{"label":"Track Order","href":"/track-order/"},{"label":"Shipping Info","href":"/shipping-policy/"},{"label":"Returns & Refunds","href":"/refund-policy/"},{"label":"My Orders","href":"/account/orders/"}]')
ON CONFLICT (key) DO NOTHING;

-- Footer: Company column links
INSERT INTO site_content (key, value) VALUES
  ('footer_company_col', '[{"label":"About Us","href":"/about/"},{"label":"Privacy Policy","href":"/privacy-policy/"},{"label":"Terms of Use","href":"/terms/"},{"label":"Careers","href":"/about/"},{"label":"Sustainability","href":"/about/"},{"label":"Press","href":"/about/"}]')
ON CONFLICT (key) DO NOTHING;

-- Footer: Legal / bottom links
INSERT INTO site_content (key, value) VALUES
  ('footer_legal_links', '[{"label":"Privacy","href":"/privacy-policy/"},{"label":"Terms","href":"/terms/"},{"label":"Refunds","href":"/refund-policy/"},{"label":"Shipping","href":"/shipping-policy/"}]')
ON CONFLICT (key) DO NOTHING;

-- Footer: copyright text
INSERT INTO site_content (key, value) VALUES
  ('footer_copyright', 'KALOKEA. All rights reserved.')
ON CONFLICT (key) DO NOTHING;

GRANT ALL ON site_content TO service_role;
