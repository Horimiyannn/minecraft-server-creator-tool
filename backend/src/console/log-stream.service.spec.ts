import { Readable } from 'node:stream';
import { LogStreamService } from './log-stream.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';

function makeService(stream: Readable = newStream()) {
  const destroy = jest.spyOn(stream, 'destroy');
  const dockerService = {
    logs: jest.fn().mockResolvedValue(stream),
  } as unknown as jest.Mocked<DockerService>;
  const serversService = {
    resolveContainerId: jest.fn().mockResolvedValue('c1'),
  } as unknown as jest.Mocked<ServersService>;
  return {
    logStreamService: new LogStreamService(dockerService, serversService),
    dockerService,
    stream,
    emit: (chunk: string) => stream.emit('data', Buffer.from(chunk, 'utf8')),
    destroyed: () => destroy.mock.calls.length > 0,
  };
}

function newStream(): Readable {
  return new Readable({ read() {} });
}

// let queued 'data' handlers run
const flush = () => new Promise((r) => setImmediate(r));

describe('LogStreamService', () => {
  it('splits chunks into whole lines and strips a trailing CR', async () => {
    const { logStreamService, stream } = makeService();
    const lines: string[] = [];
    const release = await logStreamService.subscribe('srv1', (l) =>
      lines.push(l),
    );
    stream.push('one\r\ntwo\nthr'); // "thr" is a partial line, held back
    await flush();
    expect(lines).toEqual(['one', 'two']);
    stream.push('ee\n');
    await flush();
    expect(lines).toEqual(['one', 'two', 'three']);
    release();
  });

  it('flushes a trailing partial line when the stream ends', async () => {
    const { logStreamService, stream } = makeService();
    const lines: string[] = [];
    await logStreamService.subscribe('srv1', (l) => lines.push(l));
    stream.push('no newline here');
    stream.push(null); // end
    await flush();
    expect(lines).toEqual(['no newline here']);
  });

  it('opens only one docker stream per server', async () => {
    const { logStreamService, dockerService } = makeService();
    const releaseA = await logStreamService.subscribe('srv1', () => undefined);
    const releaseB = await logStreamService.subscribe('srv1', () => undefined);
    expect(dockerService.logs).toHaveBeenCalledTimes(1);
    releaseA();
    releaseB();
  });

  it('destroys the stream when the only listener releases', async () => {
    const { logStreamService, destroyed } = makeService();
    const release = await logStreamService.subscribe('srv1', () => undefined);
    release();
    expect(destroyed()).toBe(true);
  });

  it('fans one docker stream out to several listeners', async () => {
    const { logStreamService, emit } = makeService();
    const a: string[] = [];
    const b: string[] = [];

    await logStreamService.subscribe('s1', (line) => a.push(line));
    await logStreamService.subscribe('s1', (line) => b.push(line));
    emit('hello\n');

    expect(a).toEqual(['hello']);
    expect(b).toEqual(['hello']);
  });

  it('keeps the stream alive until the last listener releases', async () => {
    const { logStreamService, destroyed, emit } = makeService();
    const releaseA = await logStreamService.subscribe('s1', () => undefined);
    const seen: string[] = [];
    const releaseB = await logStreamService.subscribe('s1', (line) =>
      seen.push(line),
    );

    releaseA();
    emit('still here\n');
    expect(seen).toEqual(['still here']);
    expect(destroyed()).toBe(false);

    releaseB();
    expect(destroyed()).toBe(true);
  });

  it('releasing twice is a no-op', async () => {
    const { logStreamService, destroyed } = makeService();
    const release = await logStreamService.subscribe('s1', () => undefined);
    release();
    release();
    expect(destroyed()).toBe(true);
  });

  it('tells listeners when the stream ends so they can re-subscribe', async () => {
    const { logStreamService, stream, dockerService } = makeService();
    const ended: string[] = [];
    await logStreamService.subscribe(
      's1',
      () => undefined,
      () => ended.push('end'),
    );

    stream.push(null);
    await flush();

    expect(ended).toEqual(['end']);
    // The entry is gone, so the next subscribe opens a fresh docker stream.
    await logStreamService.subscribe('s1', () => undefined);
    expect(dockerService.logs).toHaveBeenCalledTimes(2);
  });

  it('keeps one listener failure from starving the others', async () => {
    const { logStreamService, emit } = makeService();
    const seen: string[] = [];
    await logStreamService.subscribe('s1', () => {
      throw new Error('listener blew up');
    });
    await logStreamService.subscribe('s1', (line) => seen.push(line));

    emit('hello\n');

    expect(seen).toEqual(['hello']);
  });
});
