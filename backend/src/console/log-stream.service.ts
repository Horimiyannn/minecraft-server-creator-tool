import { Injectable } from '@nestjs/common';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';

interface LogStream {
  stream: NodeJS.ReadableStream;
  buffer: string;
  onLine: (line: string) => void;
}

/**
 * Owns one live docker log stream per server and fans its lines out to a
 * caller-supplied sink. `subscribe` is idempotent per server (the gateway
 * calls it on every join); `unsubscribe` tears the stream down when the last
 * viewer leaves. Keeping this lifecycle here — not in the gateway — is what
 * lets the gateway stay a thin router.
 */
@Injectable()
export class LogStreamService {
  private readonly streams = new Map<string, LogStream>();
  private readonly starting = new Set<string>();

  constructor(
    private readonly dockerService: DockerService,
    private readonly serversService: ServersService,
  ) {}

  async subscribe(
    serverId: string,
    onLine: (line: string) => void,
  ): Promise<void> {
    if (this.streams.has(serverId) || this.starting.has(serverId)) return;
    this.starting.add(serverId); // reserve synchronously — no concurrent-join dupe
    try {
      const containerId =
        await this.serversService.resolveContainerId(serverId);
      const stream = await this.dockerService.logs(containerId, { tail: 200 });
      const entry: LogStream = { stream, buffer: '', onLine };
      this.streams.set(serverId, entry);
      stream.on('data', (chunk: Buffer) => this.fanOut(entry, chunk));
      stream.on('end', () => this.finish(serverId, entry));
      stream.on('error', () => this.finish(serverId, entry));
    } finally {
      this.starting.delete(serverId);
    }
  }

  unsubscribe(serverId: string): void {
    const entry = this.streams.get(serverId);
    if (!entry) return;
    this.streams.delete(serverId);
    (entry.stream as unknown as { destroy?: () => void }).destroy?.();
  }

  private fanOut(entry: LogStream, chunk: Buffer): void {
    entry.buffer += chunk.toString('utf8');
    const lines = entry.buffer.split('\n');
    entry.buffer = lines.pop() ?? '';
    for (const line of lines) {
      entry.onLine(line.replace(/\r$/, ''));
    }
  }

  private finish(serverId: string, entry: LogStream): void {
    if (this.streams.get(serverId) !== entry) return; // superseded — ignore
    if (entry.buffer) entry.onLine(entry.buffer.replace(/\r$/, '')); // flush tail
    this.streams.delete(serverId);
  }
}
