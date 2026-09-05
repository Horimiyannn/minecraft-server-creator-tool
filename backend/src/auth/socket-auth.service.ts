import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { JwtPayload } from './auth.service';

interface HandshakeLike {
  handshake: { headers: { cookie?: string } };
}

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  return header
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

@Injectable()
export class SocketAuthService {
  constructor(private readonly jwtService: JwtService) {}

  authenticate(client: HandshakeLike): JwtPayload {
    const token = readCookie(client.handshake.headers.cookie, 'mcp_token');
    if (!token) {
      throw new WsException('Not authenticated');
    }
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new WsException('Invalid or expired token');
    }
  }
}
