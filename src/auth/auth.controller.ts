import { Controller, Get, Post, Body, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // max 3 OTP requests/min per IP
  @Post('send-otp')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // max 10 verify attempts/min per IP
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(dto);
    res.cookie('refresh_token', result.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return { access_token: result.access_token, user: result.user };
  }

  @Public()
  @Post('refresh')
  refresh(@Req() req: Request) {
    const token = req.cookies?.refresh_token;
    return this.auth.refresh(token);
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Revoke server-side (bumps token_version) so the refresh token can't be
    // replayed, then clear the cookie.
    await this.auth.logout(req.cookies?.refresh_token);
    res.clearCookie('refresh_token');
    return { message: 'Logged out' };
  }

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.auth.getMe(user.id);
  }
}
