import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { TarService } from './tar.service';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

/** A tar that prints a warning and exits with the given code. */
function fakeTar(exitCode: number): void {
  (spawn as jest.Mock).mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
    };
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stderr.emit(
        'data',
        Buffer.from('tar: world/level.dat: file changed as we read it\n'),
      );
      child.emit('close', exitCode);
    });
    return child;
  });
}

describe('TarService exit codes', () => {
  const tarService = new TarService();
  const create = () =>
    tarService.create({ cwd: '/data', paths: ['world'], dest: '/out.tar.zst' });

  it('accepts exit 1, which tar uses for files that changed while it read them', async () => {
    fakeTar(1);
    await expect(create()).resolves.toBeUndefined();
  });

  it('still rejects a fatal exit code', async () => {
    fakeTar(2);
    await expect(create()).rejects.toThrow(/file changed as we read it/);
  });
});
