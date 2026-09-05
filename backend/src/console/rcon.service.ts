import { Injectable } from '@nestjs/common';
import { Rcon } from 'rcon-client';
import { ServersService } from '../servers/servers.service';

@Injectable()
export class RconService {
  private readonly pool = new Map<string, Rcon>();

  constructor(private readonly serversService: ServersService) {}

  async send(serverId: string, command: string): Promise<string> {
    const rcon = await this.connection(serverId);
    try {
      return await rcon.send(command);
    } catch (error) {
      this.evict(serverId);
      throw error;
    }
  }

  evict(serverId: string): void {
    const rcon = this.pool.get(serverId);
    if (rcon) {
      this.pool.delete(serverId);
      void rcon.end().catch(() => undefined);
    }
  }

  private async connection(serverId: string): Promise<Rcon> {
    const existing = this.pool.get(serverId);
    if (existing) return existing;
    const { host, port, password } =
      await this.serversService.getRconTarget(serverId);
    const rcon = await Rcon.connect({ host, port, password });
    rcon.on('end', () => this.pool.delete(serverId));
    this.pool.set(serverId, rcon);
    return rcon;
  }
}
