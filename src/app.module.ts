import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { AdminAuditInterceptor } from './common/interceptors/admin-audit.interceptor';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { VariantsModule } from './variants/variants.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { UsersModule } from './users/users.module';
import { AddressesModule } from './addresses/addresses.module';
import { CouponsModule } from './coupons/coupons.module';
import { WishlistsModule } from './wishlists/wishlists.module';
import { BannersModule } from './banners/banners.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ReturnsModule } from './returns/returns.module';
import { UploadModule } from './upload/upload.module';
import { AdminModule } from './admin/admin.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { FeedModule } from './feed/feed.module';
import { SettingsModule } from './settings/settings.module';
import { GstModule } from './gst/gst.module';
import { ExchangesModule } from './exchanges/exchanges.module';
import { SmsModule } from './sms/sms.module';
import { ContactModule } from './contact/contact.module';
import { CronModule } from './cron/cron.module';
import { HomepageContentModule } from './homepage-content/homepage-content.module';
import { SiteContentModule } from './site-content/site-content.module';
import { ShiprocketModule } from './shiprocket/shiprocket.module';
import { CmsModule } from './cms/cms.module';
import { InstagramFeedModule } from './instagram-feed/instagram-feed.module';
import { StockNotificationsModule } from './stock-notifications/stock-notifications.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { validate } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    // ── Cache: in-memory by default; Redis when REDIS_URL env var is set.
    // To enable Redis: set REDIS_URL=redis://... in Railway environment.
    // Install: npm install @keyv/redis (already in package.json)
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
            const { createKeyv } = require('@keyv/redis') as any;
            return { stores: [createKeyv(redisUrl)], ttl: 60_000 };
          } catch {
            // @keyv/redis not installed — fall back to in-memory cache
          }
        }
        return { ttl: 60_000, max: 500 };
      },
    }),
    DatabaseModule,
    EmailModule,
    HealthModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    VariantsModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    UsersModule,
    AddressesModule,
    CouponsModule,
    WishlistsModule,
    BannersModule,
    ReviewsModule,
    ReturnsModule,
    UploadModule,
    AdminModule,
    NewsletterModule,
    FeedModule,
    SettingsModule,
    GstModule,
    ExchangesModule,
    SmsModule,
    ContactModule,
    CronModule,
    HomepageContentModule,
    SiteContentModule,
    ShiprocketModule,
    CmsModule,
    InstagramFeedModule,
    StockNotificationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor },
  ],
})
export class AppModule {}
