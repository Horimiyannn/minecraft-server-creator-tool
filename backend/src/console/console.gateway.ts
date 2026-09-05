import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketAuthService } from '../auth/socket-auth.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';
import { RconService } from './rcon.service';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';

interface LogStream {
  stream: NodeJS.ReadableStream;
  buffer: string;
  count: number;
}

@WebSocketGateway({
  namespace: '/console',
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
})
export class ConsoleGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server!: Server;
  private readonly streams = new Map<string, LogStream>();

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly dockerService: DockerService,
    private readonly serversService: ServersService,
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
    // ('disconnect' fires after it is cleared) — detach log streams here.
    client.on('disconnecting', () => {
      for (const room of client.rooms) {
        if (room.startsWith('server:')) {
          this.release(room.slice('server:'.length));
        }
      }
    });
  }

  @SubscribeMessage('join')
  async join(client: Socket, payload: { serverId: string }): Promise<void> {
    const { serverId } = payload;
    await client.join(`server:${serverId}`);
    await this.attach(serverId);
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

  private async attach(serverId: string): Promise<void> {
    const existing = this.streams.get(serverId);
    if (existing) {
      existing.count += 1;
      return;
    }
    const containerId = await this.serversService.resolveContainerId(serverId);
    const stream = await this.dockerService.logs(containerId, { tail: 200 });
    const entry: LogStream = { stream, buffer: '', count: 1 };
    this.streams.set(serverId, entry);
    stream.on('data', (chunk: Buffer) => this.fanOut(serverId, entry, chunk));
    stream.on('end', () => this.streams.delete(serverId));
    stream.on('error', () => this.streams.delete(serverId));
  }

  private fanOut(serverId: string, entry: LogStream, chunk: Buffer): void {
    entry.buffer += chunk.toString('utf8');
    const lines = entry.buffer.split('\n');
    entry.buffer = lines.pop() ?? '';
    for (const line of lines) {
      this.server.to(`server:${serverId}`).emit('log', { serverId, line });
    }
  }

  private release(serverId: string): void {
    const entry = this.streams.get(serverId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) {
      this.streams.delete(serverId);
      (entry.stream as unknown as { destroy?: () => void }).destroy?.();
    }
  }
}
