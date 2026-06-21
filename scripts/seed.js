/**
 * Kalokea Database Seed Script (plain Node.js — no ts-node needed)
 *
 * Creates:
 *  - 9 categories (New Arrivals, Dresses, Tops, Bottoms, Shoes, Bags, Accessories, Sale, Everything)
 *  - 3 demo products with variants
 *  - store_settings defaults
 *
 * Run ONCE on a fresh database (safe to re-run — upserts):
 *   node scripts/seed.js
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_KEY  (copy from .env.example → .env)
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const fs   = require('fs');

// Load .env if present
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function upsertCategory(cat) {
  const s = toSlug(cat.name);
  const { data, error } = await db
    .from('categories')
    .upsert({ name: cat.name, slug: s, description: cat.description || null,
              parent_id: cat.parent_id || null, is_active: true }, { onConflict: 'slug' })
    .select('id')
    .single();
  if (error) throw new Error(`Category upsert failed (${cat.name}): ${error.message}`);
  console.log(`  ✓ Category: ${cat.name}`);
  return data.id;
}

async function upsertProduct(prod) {
  const s = toSlug(prod.name);
  const { data, error } = await db
    .from('products')
    .upsert({
      name:        prod.name,
      slug:        s,
      description: prod.description,
      category_id: prod.category_id,
      hsn_code:    prod.hsn_code   || '6204',
      gst_rate:    prod.gst_rate   !== undefined ? prod.gst_rate : 5,
      is_active:   true,
      is_featured: !!prod.is_featured,
    }, { onConflict: 'slug' })
    .select('id')
    .single();
  if (error) throw new Error(`Product upsert failed (${prod.name}): ${error.message}`);
  console.log(`  ✓ Product: ${prod.name}`);
  return data.id;
}

async function upsertVariant(v) {
  const { error } = await db
    .from('product_variants')
    .upsert({ ...v, is_active: true }, { onConflict: 'sku' });
  if (error) throw new Error(`Variant upsert failed (${v.sku}): ${error.message}`);
  console.log(`    ✓ ${v.sku} — ${v.colour || ''} ${v.size || ''} ₹${v.price / 100}`);
}

// ── Categories ────────────────────────────────────────────────────────────────

async function seedCategories() {
  console.log('\n📂  Seeding categories…');
  const defs = [
    { key: 'new-arrivals', name: 'New Arrivals',  description: 'Freshest additions to the collection' },
    { key: 'dresses',      name: 'Dresses',        description: 'Sundresses to evening gowns' },
    { key: 'tops',         name: 'Tops',           description: 'Blouses, shirts, and more' },
    { key: 'bottoms',      name: 'Bottoms',        description: 'Trousers, skirts, and shorts' },
    { key: 'shoes',        name: 'Shoes',          description: 'Heels, flats, and everything between' },
    { key: 'bags',         name: 'Bags',           description: 'Handbags, totes, and clutches' },
    { key: 'accessories',  name: 'Accessories',    description: 'Jewellery, scarves, belts, and more' },
    { key: 'sale',         name: 'Sale',           description: 'Up to 50% off selected styles' },
    { key: 'everything',   name: 'Everything',     description: 'Browse the full Kalokea collection' },
  ];
  const ids = {};
  for (const c of defs) ids[c.key] = await upsertCategory({ name: c.name, description: c.description });
  return ids;
}

// ── Products ──────────────────────────────────────────────────────────────────

async function seedProducts(ids) {
  console.log('\n👗  Seeding demo products…');

  // 1 — Floral Silk Wrap Dress
  const dressId = await upsertProduct({
    name: 'Floral Silk Wrap Dress',
    description: 'Effortlessly elegant wrap dress in pure silk with delicate floral print. Adjustable tie waist, fluid A-line silhouette. Dry clean only.',
    category_id: ids['dresses'], hsn_code: '6204', gst_rate: 5, is_featured: true,
  });
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    for (const colour of ['Ivory', 'Blush']) {
      if (size === 'XL' && colour === 'Blush') continue;
      await upsertVariant({ product_id: dressId, sku: `FSD-${size}-${colour.toUpperCase().slice(0,3)}`, size, colour, price: 599900, stock: 8 });
    }
  }

  // 2 — Classic Linen Blazer
  const blazerId = await upsertProduct({
    name: 'Classic Linen Blazer',
    description: 'Sharp-shouldered linen blazer, relaxed fit. Single-breasted, notch lapel, two patch pockets. Machine washable on gentle cycle.',
    category_id: ids['tops'], hsn_code: '6201', gst_rate: 12, is_featured: true,
  });
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    for (const colour of ['Ivory', 'Charcoal']) {
      await upsertVariant({ product_id: blazerId, sku: `CLB-${size}-${colour.toUpperCase().slice(0,3)}`, size, colour, price: 449900, stock: 8 });
    }
  }

  // 3 — Wide-Leg Linen Trousers
  const trousersId = await upsertProduct({
    name: 'Wide-Leg Linen Trousers',
    description: 'High-waisted wide-leg trousers in breathable linen. Elastic waistband with drawstring, side pockets. Year-round wardrobe essential.',
    category_id: ids['bottoms'], hsn_code: '6204', gst_rate: 5, is_featured: false,
  });
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    for (const colour of ['Black', 'Sage']) {
      await upsertVariant({ product_id: trousersId, sku: `WLT-${size}-${colour.toUpperCase().slice(0,3)}`, size, colour, price: 299900, stock: 15 });
    }
  }
}

// ── Store Settings ────────────────────────────────────────────────────────────

async function seedSettings() {
  console.log('\n⚙️   Seeding store settings…');
  const defaults = {
    seller_name: 'Kalokea Fashion Pvt Ltd',
    seller_address: '123 Fashion Street, Mumbai, Maharashtra 400001',
    seller_gstin: '',
    seller_state: 'Maharashtra',
    gst_rate: 5,
    admin_email: 'support@kalokea.com',
    shipping_free_threshold: 99900,
    shipping_fee: 4900,
    cod_fee: 4900,
  };
  const { data: existing } = await db.from('store_settings').select('id').limit(1).maybeSingle();
  if (existing) {
    await db.from('store_settings').update(defaults).eq('id', existing.id);
    console.log('  ✓ store_settings updated');
  } else {
    await db.from('store_settings').insert(defaults);
    console.log('  ✓ store_settings created');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Kalokea seed script');
  console.log(`    Supabase: ${SUPABASE_URL}`);
  try {
    const ids = await seedCategories();
    await seedProducts(ids);
    await seedSettings();
    console.log('\n✅  Done! Next steps:');
    console.log('  1. Verify data in Supabase → Table Editor');
    console.log('  2. Upload product images via Admin panel');
    console.log('  3. Set seller_gstin in Admin → Settings before issuing invoices');
    console.log('  4. Trigger a Cloudflare Pages redeploy to rebuild static product pages');
  } catch (err) {
    console.error('\n❌  Seed failed:', err.message);
    process.exit(1);
  }
}

main();
