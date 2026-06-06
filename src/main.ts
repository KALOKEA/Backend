import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
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
  // https://kalokea.in, https://www.kalokea.in, https://kalokea.pages.dev
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
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

  await app.listen(process.env.PORT || 3001);
  console.log(`Kalokea API running on port ${process.env.PORT || 3001}`);
}
bootstrap();
