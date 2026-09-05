import { Injectable } from '@nestjs/common';
import { Rcon } from 'rcon-client';
import { ServersService } from '../servers/servers.service';

@Injectable()
export class RconService {
  private readonly pool = new Map<string, Rcon>();
  // In-flight connects, so concurrent sends for one server share a single
  // connection instead of racing and leaking the loser.
  private readonly connecting = new Map<string, Promise<Rcon>>();

  constructor(private readonly serversService: ServersService) {}

  async send(serverId: string, command: string): Promise<string> {
    const rcon = await this.connection(serverId);
    try {
      return await rcon.send(command);
    } catch (error) {
      this.evict(serverId, rcon);
      throw error;
    }
  }

  // Evict only if `rcon` is still the pooled connection (identity guard): a
  // stale handler from a replaced connection must not drop the live one.
  evict(serverId: string, rcon?: Rcon): void {
    const pooled = this.pool.get(serverId);
    if (!pooled || (rcon && pooled !== rcon)) return;
    this.pool.delete(serverId);
    void pooled.end().catch(() => undefined);
  }

  private connection(serverId: string): Promise<Rcon> {
    const existing = this.pool.get(serverId);
    if (existing) return Promise.resolve(existing);
    const pending = this.connecting.get(serverId);
    if (pending) return pending;

    const promise = (async () => {
      const { host, port, password } =
        await this.serversService.getRconTarget(serverId);
      const rcon = await Rcon.connect({ host, port, password });
      rcon.on('end', () => this.evict(serverId, rcon));
      this.pool.set(serverId, rcon);
      return rcon;
    })().finally(() => this.connecting.delete(serverId));

    this.connecting.set(serverId, promise);
    return promise;
  }
}
