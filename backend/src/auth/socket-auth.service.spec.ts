import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { SocketAuthService } from './socket-auth.service';

function client(cookie?: string) {
  return { handshake: { headers: cookie ? { cookie } : {} } };
}

describe('SocketAuthService.authenticate', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });
  const service = new SocketAuthService(jwtService);

  it('returns the payload for a valid mcp_token cookie', () => {
    const token = jwtService.sign({ sub: 1, username: 'admin' });
    const payload = service.authenticate(client(`mcp_token=${token}; other=x`));
    expect(payload.username).toBe('admin');
    expect(payload.sub).toBe(1);
  });

  it('throws WsException when no cookie header is present', () => {
    expect(() => service.authenticate(client())).toThrow(WsException);
  });

  it('throws WsException when mcp_token is absent', () => {
    expect(() => service.authenticate(client('other=x'))).toThrow(WsException);
  });

  it('throws WsException for an invalid token', () => {
    expect(() => service.authenticate(client('mcp_token=garbage'))).toThrow(
      WsException,
    );
  });
});
