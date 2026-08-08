import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: number;
  username: string;
}

const COOKIE_NAME = 'mcp_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto, res: Response): Promise<{ username: string }> {
    const user = await this.usersService.validateCredentials(
      dto.username,
      dto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    res.cookie(COOKIE_NAME, this.signToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
    return { username: user.username };
  }

  logout(res: Response): { ok: true } {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  me(user: JwtPayload): { username: string } {
    return { username: user.username };
  }

  private signToken(user: { id: number; username: string }): string {
    const payload: JwtPayload = { sub: user.id, username: user.username };
    return this.jwtService.sign(payload);
  }
}
