import { Readable } from 'node:stream';
import { LogStreamService } from './log-stream.service';
import { DockerService } from '../servers/docker.service';
import { ServersService } from '../servers/servers.service';

function make(stream: Readable) {
  const dockerService = {
    logs: jest.fn().mockResolvedValue(stream),
  } as unknown as jest.Mocked<DockerService>;
  const serversService = {
    resolveContainerId: jest.fn().mockResolvedValue('c1'),
  } as unknown as jest.Mocked<ServersService>;
  return {
    service: new LogStreamService(dockerService, serversService),
    dockerService,
  };
}

function newStream(): Readable {
  return new Readable({ read() {} });
}

// let queued 'data' handlers run
const flush = () => new Promise((r) => setImmediate(r));

describe('LogStreamService', () => {
  it('splits chunks into whole lines and strips a trailing CR', async () => {
    const stream = newStream();
    const { service } = make(stream);
    const lines: string[] = [];
    await service.subscribe('srv1', (l) => lines.push(l));
    stream.push('one\r\ntwo\nthr'); // "thr" is a partial line, held back
    await flush();
    expect(lines).toEqual(['one', 'two']);
    stream.push('ee\n');
    await flush();
    expect(lines).toEqual(['one', 'two', 'three']);
    service.unsubscribe('srv1');
  });

  it('flushes a trailing partial line when the stream ends', async () => {
    const stream = newStream();
    const { service } = make(stream);
    const lines: string[] = [];
    await service.subscribe('srv1', (l) => lines.push(l));
    stream.push('no newline here');
    stream.push(null); // end
    await flush();
    expect(lines).toEqual(['no newline here']);
  });

  it('is idempotent — a second subscribe does not open a second stream', async () => {
    const { service, dockerService } = make(newStream());
    await service.subscribe('srv1', () => undefined);
    await service.subscribe('srv1', () => undefined);
    expect(dockerService.logs).toHaveBeenCalledTimes(1);
    service.unsubscribe('srv1');
  });

  it('destroys the stream on unsubscribe', async () => {
    const stream = newStream();
    const destroy = jest.spyOn(stream, 'destroy');
    const { service } = make(stream);
    await service.subscribe('srv1', () => undefined);
    service.unsubscribe('srv1');
    expect(destroy).toHaveBeenCalled();
  });
});
