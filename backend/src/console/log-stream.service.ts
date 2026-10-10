import { Injectable } from '@nestjs/common';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';

interface LogStream {
  stream: NodeJS.ReadableStream;
  buffer: string;
  listeners: Set<(line: string) => void>;
}

/**
 * Owns one live docker log stream per server and fans its lines out to every
 * attached sink. Keeping this lifecycle here — not in the gateway — is what
 * lets the gateway stay a thin router and lets the backup chat trigger watch
 * a server with no browser connected.
 */
@Injectable()
export class LogStreamService {
  private readonly streams = new Map<string, LogStream>();
  private readonly starting = new Map<string, Promise<LogStream>>();

  constructor(
    private readonly dockerService: DockerService,
    private readonly serversService: ServersService,
  ) {}

  /**
   * Attach a sink to this server's log stream, creating the docker stream on
   * first use. Returns a release function; the stream is torn down when the
   * last listener releases.
   */
  async subscribe(
    serverId: string,
    onLine: (line: string) => void,
  ): Promise<() => void> {
    const entry = await this.ensure(serverId);
    entry.listeners.add(onLine);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.listeners.delete(onLine);
      if (entry.listeners.size === 0) this.teardown(serverId, entry);
    };
  }

  private ensure(serverId: string): Promise<LogStream> {
    const existing = this.streams.get(serverId);
    if (existing) return Promise.resolve(existing);
    const pending = this.starting.get(serverId);
    if (pending) return pending; // concurrent joins share one docker stream

    const promise = (async () => {
      const containerId =
        await this.serversService.resolveContainerId(serverId);
      const stream = await this.dockerService.logs(containerId, { tail: 200 });
      const entry: LogStream = { stream, buffer: '', listeners: new Set() };
      this.streams.set(serverId, entry);
      stream.on('data', (chunk: Buffer) => this.fanOut(entry, chunk));
      stream.on('end', () => this.finish(serverId, entry));
      stream.on('error', () => this.finish(serverId, entry));
      return entry;
    })().finally(() => this.starting.delete(serverId));

    this.starting.set(serverId, promise);
    return promise;
  }

  private teardown(serverId: string, entry: LogStream): void {
    if (this.streams.get(serverId) !== entry) return;
    this.streams.delete(serverId);
    (entry.stream as unknown as { destroy?: () => void }).destroy?.();
  }

  private fanOut(entry: LogStream, chunk: Buffer): void {
    entry.buffer += chunk.toString('utf8');
    const lines = entry.buffer.split('\n');
    entry.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const clean = line.replace(/\r$/, '');
      for (const listener of entry.listeners) listener(clean);
    }
  }

  private finish(serverId: string, entry: LogStream): void {
    if (this.streams.get(serverId) !== entry) return; // superseded — ignore
    if (entry.buffer) {
      const clean = entry.buffer.replace(/\r$/, ''); // flush tail
      for (const listener of entry.listeners) listener(clean);
    }
    this.streams.delete(serverId);
  }
}
