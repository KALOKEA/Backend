import { Controller, Get, Post, Body, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { ApiTags } from '@nestjs/swagger';

/** Cookie settings shared by verify-otp and refresh. */
const REFRESH_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('send-otp')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(dto);
    res.cookie('refresh_token', result.refresh_token, REFRESH_COOKIE);
    return { access_token: result.access_token, user: result.user };
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.refresh_token;
    const result = await this.auth.refresh(token);
    res.cookie('refresh_token', result.refresh_token, REFRESH_COOKIE);
    return { access_token: result.access_token };
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.refresh_token);
    res.clearCookie('refresh_token');
    return { message: 'Logged out' };
  }

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.auth.getMe(user.id);
  }

  // ── 2FA endpoints (admin only) ──────────────────────────────────────────

  /** GET /auth/2fa/status — is 2FA enabled for the current admin? */
  @UseGuards(AdminGuard)
  @Get('2fa/status')
  get2faStatus(@CurrentUser() user: any) {
    return this.twoFactor.getStatus(user.id);
  }

  /** POST /auth/2fa/setup — generate QR code + secret (does NOT enable yet). */
  @UseGuards(AdminGuard)
  @Post('2fa/setup')
  setup2fa(@CurrentUser() user: any) {
    return this.twoFactor.setup(user.id, user.email || user.phone || 'admin');
  }

  /** POST /auth/2fa/enable — verify first TOTP code and activate 2FA. */
  @UseGuards(AdminGuard)
  @Post('2fa/enable')
  enable2fa(@CurrentUser() user: any, @Body('token') token: string) {
    return this.twoFactor.enable(user.id, token);
  }

  /** POST /auth/2fa/verify — verify TOTP (used by admin panel sensitive actions). */
  @UseGuards(AdminGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/verify')
  verify2fa(@CurrentUser() user: any, @Body('token') token: string) {
    return this.twoFactor.verify(user.id, token);
  }

  /** POST /auth/2fa/disable — disable 2FA (requires valid TOTP to confirm). */
  @UseGuards(AdminGuard)
  @Post('2fa/disable')
  disable2fa(@CurrentUser() user: any, @Body('token') token: string) {
    return this.twoFactor.disable(user.id, token);
  }
}
