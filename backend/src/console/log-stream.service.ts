import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';

interface Listener {
  onLine: (line: string) => void;
  onEnd?: () => void;
}

interface LogStream {
  stream: NodeJS.ReadableStream;
  buffer: string;
  listeners: Set<Listener>;
}

/**
 * Owns one live docker log stream per server and fans its lines out to every
 * attached sink. Keeping this lifecycle here — not in the gateway — is what
 * lets the gateway stay a thin router and lets the backup chat trigger watch
 * a server with no browser connected.
 */
@Injectable()
export class LogStreamService {
  private readonly logger = new Logger(LogStreamService.name);
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
   *
   * `onEnd` fires when the docker stream ends on its own — the container was
   * stopped or restarted. Without it a listener would hold a release handle
   * for a stream that is already gone and never re-subscribe.
   */
  async subscribe(
    serverId: string,
    onLine: (line: string) => void,
    onEnd?: () => void,
  ): Promise<() => void> {
    const entry = await this.ensure(serverId);
    const listener: Listener = { onLine, onEnd };
    entry.listeners.add(listener);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.listeners.delete(listener);
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
      this.emit(entry, clean);
    }
  }

  /** One listener throwing must not starve the ones after it. */
  private emit(entry: LogStream, line: string): void {
    for (const listener of entry.listeners) {
      try {
        listener.onLine(line);
      } catch (error) {
        this.logger.warn(`log listener threw: ${String(error)}`);
      }
    }
  }

  private finish(serverId: string, entry: LogStream): void {
    if (this.streams.get(serverId) !== entry) return; // superseded — ignore
    if (entry.buffer) {
      this.emit(entry, entry.buffer.replace(/\r$/, '')); // flush tail
      entry.buffer = '';
    }
    this.streams.delete(serverId);
    const listeners = [...entry.listeners];
    entry.listeners.clear(); // release handles must not keep sinks alive
    for (const listener of listeners) {
      try {
        listener.onEnd?.();
      } catch (error) {
        this.logger.warn(`log end handler threw: ${String(error)}`);
      }
    }
  }
}
