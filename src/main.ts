import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compression = require('compression');
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Railway/Cloudflare put a proxy in front of the app. Trust the first hop so
  // req.ip reflects the real client (needed for correct per-IP rate limiting).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Compress all responses — typically 60-80% smaller JSON payloads
  app.use(compression());
  app.use(helmet());
  app.use(cookieParser());

  // ALLOWED_ORIGINS (Railway env var) must include ALL frontend origins:
  // https://kalokea.in,https://www.kalokea.in
  // Add https://kalokea.pages.dev during transition if Cloudflare redirect is still active.
  // .trim() prevents accidental whitespace from producing origins that never match.
  // filter(Boolean) drops empty entries.
  //
  // SECURITY: Set SWAGGER_DISABLED=true in Railway to hide /api/docs in production.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // OpenAPI / Swagger — enabled by default; set SWAGGER_DISABLED=true in
  // production env vars to hide the docs UI if desired.
  if (process.env.SWAGGER_DISABLED !== 'true') {
    const config = new DocumentBuilder()
      .setTitle('Kalokea API')
      .setDescription(
        'REST API for the Kalokea e-commerce platform. ' +
        'Authenticated endpoints require a Bearer JWT (obtained via POST /auth/verify-otp). ' +
        'Admin endpoints additionally require role=admin on the token.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'access-token',
      )
      .addTag('auth', 'OTP-based authentication & token refresh')
      .addTag('products', 'Product catalogue (public read, admin write)')
      .addTag('categories', 'Product categories')
      .addTag('variants', 'Product variant management (admin)')
      .addTag('cart', 'Shopping cart — server-side, session or user-bound')
      .addTag('orders', 'Order placement and lifecycle')
      .addTag('payments', 'Razorpay integration — order creation, verification, webhooks')
      .addTag('addresses', 'Saved delivery addresses (authenticated users)')
      .addTag('users', 'User profile management')
      .addTag('reviews', 'Product reviews & ratings')
      .addTag('wishlists', 'Wishlist management (authenticated users)')
      .addTag('coupons', 'Discount coupon validation & redemption')
      .addTag('returns', 'Return & exchange requests')
      .addTag('exchanges', 'Exchange fulfilment (admin)')
      .addTag('gst', 'GST ledger & reporting (admin)')
      .addTag('shiprocket', 'ShipRocket shipment management (admin)')
      .addTag('banners', 'Homepage banners (admin CMS)')
      .addTag('homepage-content', 'Homepage featured content (admin CMS)')
      .addTag('upload', 'Cloudinary image upload (admin)')
      .addTag('admin', 'Admin dashboard aggregates')
      .addTag('newsletter', 'Newsletter subscription')
      .addTag('contact', 'Contact form')
      .addTag('feed', 'RSS / Atom product feed')
      .addTag('instagram-feed', 'Instagram posts feed (public)')
      .addTag('health', 'Health check')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  await app.listen(process.env.PORT || 3001);
  console.log(`Kalokea API running on port ${process.env.PORT || 3001}`);
  if (process.env.SWAGGER_DISABLED !== 'true') {
    console.log(`Swagger docs: http://localhost:${process.env.PORT || 3001}/api/docs`);
  }
}
bootstrap();
