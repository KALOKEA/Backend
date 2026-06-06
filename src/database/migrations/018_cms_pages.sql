-- Migration 018: CMS pages for admin-editable static content
CREATE TABLE IF NOT EXISTS cms_pages (
  slug            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  meta_description TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grant access to service role
GRANT ALL ON TABLE cms_pages TO service_role;

-- Seed default pages (do nothing if already exists)
INSERT INTO cms_pages (slug, title, content, meta_description) VALUES
(
  'about',
  'About Us',
  '<p>Kalokea was born from a simple belief: every woman deserves to wear something that makes her feel seen, celebrated, and entirely herself. We design fashion that speaks before you do — bold without being loud, elegant without being out of reach.</p>

<p>Founded in India, Kalokea works with skilled artisans and ethical manufacturers to bring you quality that lasts and styles that transcend trends. We believe fashion should be both beautiful and responsible.</p>

<p>From our dresses to our accessories, every piece is designed with one question in mind: does this make her feel unstoppable? If the answer is yes, it earns its place in our collection.</p>',
  'Kalokea is a women''s fashion brand celebrating confidence, elegance, and individuality.'
),
(
  'contact',
  'Contact Us',
  '<p>We''d love to hear from you. Reach out to us for any questions about your order, products, or collaboration opportunities.</p>

<p><strong>Email:</strong> support@kalokea.in<br>
<strong>Phone:</strong> +91 93101 78308<br>
<strong>Hours:</strong> Monday – Saturday, 10 AM – 6 PM IST</p>

<p>For order tracking, visit our <a href="/track-order">Track Order</a> page.</p>',
  'Contact Kalokea — we are here to help with your orders, returns, and any questions.'
),
(
  'privacy-policy',
  'Privacy Policy',
  '<p><em>Last updated: June 2025</em></p>

<h2>Information We Collect</h2>
<p>We collect information you provide when placing orders (name, email, address, phone) and usage data to improve our services.</p>

<h2>How We Use Your Information</h2>
<p>Your information is used to process orders, send order updates, and improve our services. We never sell your personal data to third parties.</p>

<h2>Cookies</h2>
<p>We use cookies to keep you logged in and remember your cart. You can disable cookies in your browser settings.</p>

<h2>Data Security</h2>
<p>We use industry-standard encryption to protect your personal information. Payment data is handled securely by Razorpay and never stored on our servers.</p>

<h2>Contact</h2>
<p>For privacy concerns, email us at privacy@kalokea.in</p>',
  'How Kalokea collects, uses, and protects your personal information.'
),
(
  'refund-policy',
  'Refund & Return Policy',
  '<p><em>Last updated: June 2025</em></p>

<h2>Return Window</h2>
<p>We accept returns within <strong>7 days</strong> of delivery for eligible items. Items must be unused, unwashed, and in original packaging with tags attached.</p>

<h2>Non-Returnable Items</h2>
<p>Sale items, innerwear, and customised products cannot be returned.</p>

<h2>How to Initiate a Return</h2>
<p>Log in to your account and visit My Orders. Click "Return" on the eligible item and follow the instructions. You can also email returns@kalokea.in with your order number.</p>

<h2>Refund Timeline</h2>
<p>Refunds are processed within <strong>5–7 business days</strong> after we receive and inspect the returned item. The amount will be credited back to your original payment method.</p>

<h2>Exchange Policy</h2>
<p>We offer free size exchanges within 7 days of delivery, subject to stock availability.</p>',
  'Kalokea refund and return policy — 7-day returns on eligible items.'
),
(
  'shipping-policy',
  'Shipping Policy',
  '<p><em>Last updated: June 2025</em></p>

<h2>Delivery Time</h2>
<p>Orders are dispatched within <strong>1–2 business days</strong>. Standard delivery takes <strong>3–7 business days</strong> depending on your location.</p>

<h2>Free Shipping</h2>
<p>We offer free shipping on orders above ₹999. Orders below ₹999 are subject to a flat shipping fee.</p>

<h2>Cash on Delivery</h2>
<p>COD is available on eligible orders across India. A small COD handling fee may apply.</p>

<h2>Order Tracking</h2>
<p>You will receive a tracking number via email and SMS once your order is dispatched. Use our <a href="/track-order">Track Order</a> page to check real-time status.</p>

<h2>Delivery Issues</h2>
<p>If your order is lost or significantly delayed, please contact us at support@kalokea.in within 15 days of the expected delivery date.</p>',
  'Kalokea shipping policy — delivery times, free shipping threshold, and tracking.'
),
(
  'terms',
  'Terms & Conditions',
  '<p><em>Last updated: June 2025</em></p>

<h2>Acceptance of Terms</h2>
<p>By using Kalokea, you agree to these terms. If you do not agree, please do not use our website.</p>

<h2>Products and Pricing</h2>
<p>All prices are in Indian Rupees (₹) and inclusive of applicable taxes. We reserve the right to modify prices at any time without prior notice.</p>

<h2>Intellectual Property</h2>
<p>All content on this website — images, text, logos — is the property of Kalokea and may not be reproduced without written permission.</p>

<h2>Limitation of Liability</h2>
<p>Kalokea is not liable for any indirect, incidental, or consequential damages arising from the use of our products or website.</p>

<h2>Governing Law</h2>
<p>These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in Ahmedabad, Gujarat.</p>',
  'Terms and conditions for using Kalokea — the women''s fashion store.'
)
ON CONFLICT (slug) DO NOTHING;
