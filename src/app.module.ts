import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
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
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { validate } from './config/env.validation';

@Module({
  imports: [
    // validate => fail-fast on missing required secrets (see config/env.validation.ts)
    ConfigModule.forRoot({ isGlobal: true, validate }),
    // Global rate limiting: max 100 requests per minute per IP by default.
    // Sensitive endpoints (e.g. OTP) tighten this further via @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
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
  ],
  providers: [
    // ThrottlerGuard runs first so rate limits apply even to auth/public routes.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
