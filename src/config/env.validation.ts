/**
 * Fail-fast environment validation.
 *
 * Wired into ConfigModule.forRoot({ validate }) in app.module.ts. If a REQUIRED
 * secret is missing the app refuses to boot with a clear message — instead of
 * starting and then throwing cryptic runtime errors on the first auth/db call.
 *
 * Zero external dependencies (no Joi) so no extra npm install is needed.
 */

// Secrets the app cannot run without — startup aborts if any are missing.
const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
] as const;

// Needed for specific features. Missing ones don't block boot but are warned
// about, so a half-configured deploy is obvious in the logs.
const FEATURE = [
  'ALLOWED_ORIGINS', // CORS allowlist (comma-separated origins)
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'BREVO_API_KEY',         // REQUIRED for any emails — warnings fire if missing
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'SHIPROCKET_EMAIL',
  'SHIPROCKET_PASSWORD',
  'SHIPROCKET_PICKUP_LOCATION',
  'SHIPROCKET_PICKUP_PINCODE',
  'SHIPROCKET_WEBHOOK_TOKEN',
  'INSTAGRAM_ACCESS_TOKEN',  // Long-lived Instagram Graph API token for feed
  'WHATSAPP_PHONE_NUMBER_ID', // Meta Cloud API — WhatsApp Business phone number ID
  'WHATSAPP_ACCESS_TOKEN',    // Meta Cloud API — permanent system user access token
] as const;

export function validate(config: Record<string, unknown>) {
  const missing = REQUIRED.filter((key) => {
    const v = config[key];
    return v === undefined || v === null || String(v).trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `See .env.example for the full list.`,
    );
  }

  // Enforce minimum entropy for JWT secrets (SEC-3).
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const v = String(config[key] || '');
    if (v.length < 32) {
      throw new Error(
        `${key} must be at least 32 characters for adequate security. ` +
          `Generate one with: openssl rand -hex 32`,
      );
    }
  }

  const missingFeature = FEATURE.filter((key) => {
    const v = config[key];
    return v === undefined || v === null || String(v).trim() === '';
  });

  if (missingFeature.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[env] Optional/feature env vars not set: ${missingFeature.join(', ')}. ` +
        `Related features (payments, email, image upload, CORS) may be disabled or fail.`,
    );
  }

  // Warn loudly if Swagger is accidentally enabled in production.
  // Swagger exposes full API schema — it must never be on in production.
  if (
    String(config['SWAGGER_ENABLED'] || '').toLowerCase() === 'true' &&
    String(config['NODE_ENV'] || '').toLowerCase() === 'production'
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[env] WARNING: SWAGGER_ENABLED=true in NODE_ENV=production — ' +
        'full API schema is publicly exposed at /api/docs. Set SWAGGER_ENABLED=false to secure.',
    );
  }

  // Warn if BREVO_API_KEY is missing — emails will silently fail on every order.
  if (!config['BREVO_API_KEY'] || String(config['BREVO_API_KEY']).trim() === '') {
    // eslint-disable-next-line no-console
    console.warn(
      '[env] WARNING: BREVO_API_KEY is not set. All transactional emails ' +
        '(OTP, order confirmation, shipping) will silently fail.',
    );
  }

  return config;
}
