import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService, JwtPayload } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

const COOKIE_NAME = 'mcp_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ username: string }> {
    const user = await this.auth.validateCredentials(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    res.cookie(COOKIE_NAME, this.auth.signToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
    return { username: user.username };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload): { username: string } {
    return { username: user.username };
  }
}
