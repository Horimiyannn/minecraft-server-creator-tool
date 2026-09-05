import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { SocketAuthService } from '../auth/socket-auth.service';
import { LogStreamService } from './log-stream.service';
import { RconService } from './rcon.service';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';

@WebSocketGateway({
  namespace: '/console',
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
})
export class ConsoleGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server!: Namespace;

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly logStreamService: LogStreamService,
    private readonly rconService: RconService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      client.data.user = this.socketAuthService.authenticate(client);
    } catch {
      client.disconnect();
      return;
    }
    // 'disconnecting' fires while client.rooms is still populated
    // ('disconnect' fires after it is cleared).
    client.on('disconnecting', () => {
      for (const room of client.rooms) {
        if (room.startsWith('server:')) this.dropIfLast(room);
      }
    });
  }

  @SubscribeMessage('join')
  async join(client: Socket, payload: { serverId: string }): Promise<void> {
    const room = `server:${payload.serverId}`;
    await client.join(room);
    // subscribe is idempotent per server, so repeat/concurrent joins are safe.
    await this.logStreamService.subscribe(payload.serverId, (line) =>
      this.server.to(room).emit('log', { serverId: payload.serverId, line }),
    );
  }

  @SubscribeMessage('leave')
  async leave(client: Socket, payload: { serverId: string }): Promise<void> {
    await client.leave(`server:${payload.serverId}`);
    this.dropIfEmpty(payload.serverId);
  }

  @SubscribeMessage('command')
  async command(
    client: Socket,
    payload: { serverId: string; command: string },
  ): Promise<void> {
    try {
      const output = await this.rconService.send(
        payload.serverId,
        payload.command,
      );
      client.emit('output', { serverId: payload.serverId, output });
    } catch (error) {
      client.emit('error', {
        message: error instanceof Error ? error.message : 'command failed',
      });
    }
  }

  private dropIfEmpty(serverId: string): void {
    if (this.roomSize(`server:${serverId}`) === 0) {
      this.logStreamService.unsubscribe(serverId);
    }
  }

  // Called from 'disconnecting', where the leaving socket is still counted.
  private dropIfLast(room: string): void {
    if (this.roomSize(room) <= 1) {
      this.logStreamService.unsubscribe(room.slice('server:'.length));
    }
  }

  private roomSize(room: string): number {
    return this.server.adapter.rooms.get(room)?.size ?? 0;
  }
}
