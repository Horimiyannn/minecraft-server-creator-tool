import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { ServerRepository, ServerRecord } from './server.repository';
import { DockerService, ContainerStatus } from './docker.service';
import { toItzgEnv, Loader } from './provisioning';
import { translateCreateError } from './server-errors';

export interface CreateServerInput {
  name: string;
  loader: Loader;
  version: string;
  loaderVersion?: string;
  ramMb: number;
  port: number;
}

export type PublicServer = Omit<ServerRecord, 'rconPassword'>;

function toPublic(record: ServerRecord): PublicServer {
  const { rconPassword: _omit, ...rest } = record;
  return rest;
}

@Injectable()
export class ServersService {
  constructor(
    private readonly serverRepository: ServerRepository,
    private readonly dockerService: DockerService,
  ) {}

  async createServer(input: CreateServerInput): Promise<PublicServer> {
    const rconPassword = randomBytes(16).toString('hex');
    const server = await this.serverRepository.create({
      ...input,
      rconPassword,
    });

    // Track the container id locally: on failure we must remove it even if
    // `setContainer` never ran (otherwise the created container is orphaned —
    // the DB row still has containerId=null so a DB lookup can't find it).
    let containerId: string | undefined;
    try {
      const env = toItzgEnv({
        loader: input.loader,
        version: input.version,
        loaderVersion: input.loaderVersion,
        ramMb: input.ramMb,
        rconPassword,
      });
      containerId = await this.dockerService.create({
        id: server.id,
        port: input.port,
        env,
        memoryMb: input.ramMb,
      });
      await this.dockerService.start(containerId);
      return toPublic(
        await this.serverRepository.setContainer(
          server.id,
          containerId,
          'running',
        ),
      );
    } catch (error) {
      await this.rollback(server.id, containerId);
      // Rollback drops the row, so the name and port are free again and the
      // user can retry straight away with a corrected value.
      throw translateCreateError(error, {
        name: input.name,
        port: input.port,
      });
    }
  }

  private async rollback(id: string, containerId?: string): Promise<void> {
    if (containerId) {
      await this.dockerService.remove(containerId).catch(() => undefined);
    }
    await this.serverRepository.delete(id).catch(() => undefined);
  }

  async listServers(): Promise<PublicServer[]> {
    return (await this.serverRepository.list()).map(toPublic);
  }

  async getServer(
    id: string,
  ): Promise<PublicServer & { live: ContainerStatus | null }> {
    const server = await this.requireServer(id);
    const live = server.containerId
      ? await this.dockerService.inspect(server.containerId).catch(() => null)
      : null;
    return { ...toPublic(server), live };
  }

  async start(id: string): Promise<PublicServer> {
    const containerId = await this.requireContainer(id);
    await this.dockerService.start(containerId);
    return toPublic(await this.serverRepository.setStatus(id, 'running'));
  }

  async stop(id: string): Promise<PublicServer> {
    const containerId = await this.requireContainer(id);
    await this.dockerService.stop(containerId);
    return toPublic(await this.serverRepository.setStatus(id, 'stopped'));
  }

  async restart(id: string): Promise<PublicServer> {
    const containerId = await this.requireContainer(id);
    await this.dockerService.restart(containerId);
    return toPublic(await this.serverRepository.setStatus(id, 'running'));
  }

  async deleteServer(id: string): Promise<void> {
    const server = await this.requireServer(id);
    if (server.containerId) {
      await this.dockerService
        .remove(server.containerId)
        .catch(() => undefined);
    }
    await this.serverRepository.delete(id);
    // The row is gone, so nothing can address these files any more. Removing
    // the whole per-server root takes data/ and backups/ together; leaving it
    // behind leaked a full server tree on every delete.
    await rm(this.dockerService.serverRoot(id), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }

  async resolveContainerId(id: string): Promise<string> {
    return this.requireContainer(id);
  }

  /** Existence check for modules that address a server by id but need no record. */
  async assertServerExists(id: string): Promise<void> {
    await this.requireServer(id);
  }

  async getRconTarget(
    id: string,
  ): Promise<{ host: string; port: number; password: string }> {
    const server = await this.requireServer(id);
    if (!server.containerId) {
      throw new NotFoundException(`Server "${id}" has no container yet`);
    }
    const { host, port } = await this.dockerService.rconEndpoint(
      server.containerId,
    );
    return { host, port, password: server.rconPassword };
  }

  private async requireServer(id: string): Promise<ServerRecord> {
    const server = await this.serverRepository.findById(id);
    if (!server) throw new NotFoundException(`Server "${id}" not found`);
    return server;
  }

  private async requireContainer(id: string): Promise<string> {
    const server = await this.requireServer(id);
    if (!server.containerId) {
      throw new NotFoundException(`Server "${id}" has no container yet`);
    }
    return server.containerId;
  }
}
