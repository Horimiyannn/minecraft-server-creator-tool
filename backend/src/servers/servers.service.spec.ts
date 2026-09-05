import { NotFoundException } from '@nestjs/common';
import { ServersService } from './servers.service';
import { ServerRepository, ServerRecord } from './server.repository';
import { DockerService } from './docker.service';

function record(over: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: 'srv1',
    name: 'survival',
    loader: 'vanilla',
    version: '1.20.1',
    ramMb: 2048,
    port: 25565,
    rconPassword: 'pw',
    containerId: null,
    status: 'creating',
    createdAt: new Date(0),
    ...over,
  };
}

function makeRepo(): jest.Mocked<ServerRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    setContainer: jest.fn().mockResolvedValue(record()),
    setStatus: jest.fn().mockResolvedValue(record()),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ServerRepository>;
}

function makeDocker(): jest.Mocked<DockerService> {
  return {
    create: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    inspect: jest.fn(),
    rconEndpoint: jest.fn(),
  } as unknown as jest.Mocked<DockerService>;
}

const input = {
  name: 'survival',
  loader: 'vanilla' as const,
  version: '1.20.1',
  ramMb: 2048,
  port: 25565,
};

describe('ServersService.createServer', () => {
  it('inserts, creates+starts the container, and marks it running', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.create.mockResolvedValue(record());
    docker.create.mockResolvedValue('c123');
    repo.setContainer.mockResolvedValue(
      record({ containerId: 'c123', status: 'running' }),
    );
    const svc = new ServersService(repo, docker);

    const result = await svc.createServer(input);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'survival', loader: 'vanilla' }),
    );
    // rcon password generated, non-empty, and passed to persistence
    expect(repo.create.mock.calls[0][0].rconPassword).toMatch(/^[0-9a-f]{32}$/);
    expect(docker.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'srv1', port: 25565 }),
    );
    expect(docker.start).toHaveBeenCalledWith('c123');
    expect(repo.setContainer).toHaveBeenCalledWith('srv1', 'c123', 'running');
    expect(result.status).toBe('running');
    expect(result).not.toHaveProperty('rconPassword');
  });

  it('rolls back to failed and rethrows when container start fails', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.create.mockResolvedValue(record());
    docker.create.mockResolvedValue('c123');
    docker.start.mockRejectedValue(new Error('daemon down'));
    // NB: setContainer never ran, so the DB row still has containerId=null.
    // Rollback must still remove the just-created container by its local id.
    repo.findById.mockResolvedValue(record({ containerId: null }));
    const svc = new ServersService(repo, docker);

    await expect(svc.createServer(input)).rejects.toThrow('daemon down');
    expect(docker.remove).toHaveBeenCalledWith('c123');
    expect(repo.setStatus).toHaveBeenCalledWith('srv1', 'failed');
  });
});

describe('ServersService lifecycle', () => {
  it('start throws NotFound when the server does not exist', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const svc = new ServersService(repo, makeDocker());
    await expect(svc.start('nope')).rejects.toThrow(NotFoundException);
  });

  it('stop stops the container and sets status stopped', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(
      record({ containerId: 'c123', status: 'running' }),
    );
    repo.setStatus.mockResolvedValue(record({ status: 'stopped' }));
    const svc = new ServersService(repo, docker);

    await svc.stop('srv1');
    expect(docker.stop).toHaveBeenCalledWith('c123');
    expect(repo.setStatus).toHaveBeenCalledWith('srv1', 'stopped');
  });

  it('deleteServer removes the container then the row', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(record({ containerId: 'c123' }));
    const svc = new ServersService(repo, docker);

    await svc.deleteServer('srv1');
    expect(docker.remove).toHaveBeenCalledWith('c123');
    expect(repo.delete).toHaveBeenCalledWith('srv1');
  });
});

describe('ServersService.getRconTarget', () => {
  it('returns the rcon endpoint plus the stored password', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(
      record({ containerId: 'c123', rconPassword: 'secret-pw' }),
    );
    docker.rconEndpoint.mockResolvedValue({ host: '127.0.0.1', port: 49222 });
    const svc = new ServersService(repo, docker);
    await expect(svc.getRconTarget('srv1')).resolves.toEqual({
      host: '127.0.0.1',
      port: 49222,
      password: 'secret-pw',
    });
  });

  it('throws NotFound when the server has no container', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(record({ containerId: null }));
    const svc = new ServersService(repo, docker);
    await expect(svc.getRconTarget('srv1')).rejects.toThrow(NotFoundException);
  });
});

describe('ServersService.resolveContainerId', () => {
  it('returns the container id', async () => {
    const repo = makeRepo();
    const docker = makeDocker();
    repo.findById.mockResolvedValue(record({ containerId: 'c123' }));
    const svc = new ServersService(repo, docker);
    await expect(svc.resolveContainerId('srv1')).resolves.toBe('c123');
  });
});
