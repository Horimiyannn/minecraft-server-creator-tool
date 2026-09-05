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
import { MetricsService } from './metrics.service';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
const POLL_MS = 2000;

interface Poll {
  timer: NodeJS.Timeout;
  count: number;
}

@WebSocketGateway({
  namespace: '/metrics',
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
})
export class MetricsGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server!: Server;
  private readonly polls = new Map<string, Poll>();

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly metricsService: MetricsService,
    private readonly dockerService: DockerService,
    private readonly serversService: ServersService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      client.data.user = this.socketAuthService.authenticate(client);
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('join')
  async join(client: Socket, payload: { serverId: string }): Promise<void> {
    const { serverId } = payload;
    await client.join(`server:${serverId}`);
    const existing = this.polls.get(serverId);
    if (existing) {
      existing.count += 1;
      return;
    }
    const containerId = await this.serversService.resolveContainerId(serverId);
    const dataDir = this.dockerService.dataDir(serverId);
    const timer = setInterval(() => {
      void this.tick(serverId, containerId, dataDir);
    }, POLL_MS);
    this.polls.set(serverId, { timer, count: 1 });
  }

  @SubscribeMessage('leave')
  leave(client: Socket, payload: { serverId: string }): void {
    this.release(payload.serverId);
  }

  private async tick(
    serverId: string,
    containerId: string,
    dataDir: string,
  ): Promise<void> {
    try {
      const stats = await this.metricsService.collect(containerId, dataDir);
      this.server
        .to(`server:${serverId}`)
        .emit('stats', { serverId, ...stats });
    } catch {
      // transient (container restarting) — skip this tick
    }
  }

  private release(serverId: string): void {
    const poll = this.polls.get(serverId);
    if (!poll) return;
    poll.count -= 1;
    if (poll.count <= 0) {
      clearInterval(poll.timer);
      this.polls.delete(serverId);
    }
  }
}
