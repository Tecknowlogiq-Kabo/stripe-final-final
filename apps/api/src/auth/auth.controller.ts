import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { Public } from './decorators/public.decorator';

const ACCESS_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private getCookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: 'strict'; path: string } {
    return {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/',
    };
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    const options = this.getCookieOptions();
    res.cookie('auth_token', accessToken, { ...options, maxAge: ACCESS_MAX_AGE });
    res.cookie('refresh_token', refreshToken, { ...options, maxAge: REFRESH_MAX_AGE });
  }

  private clearAuthCookies(res: Response): void {
    const options = { path: '/' };
    res.clearCookie('auth_token', options);
    res.clearCookie('refresh_token', options);
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  /** Exchange a valid refresh token for a new access + refresh token pair. */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }
    const result = await this.authService.refresh(refreshToken);
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  /** Revoke the refresh token (logout). */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    this.clearAuthCookies(res);
  }
}
