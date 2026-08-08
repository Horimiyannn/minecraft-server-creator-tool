import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: number;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  validateCredentials(
    username: string,
    password: string,
  ): Promise<{ id: number; username: string } | null> {
    return this.users.validateCredentials(username, password);
  }

  signToken(user: { id: number; username: string }): string {
    const payload: JwtPayload = { sub: user.id, username: user.username };
    return this.jwt.sign(payload);
  }
}
