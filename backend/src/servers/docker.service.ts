import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import Docker from 'dockerode';

export interface CreateContainerOptions {
  id: string;
  port: number;
  env: string[];
}

export interface ContainerStatus {
  running: boolean;
  status: string;
}

const CONTAINER_MC_PORT = '25565/tcp';

@Injectable()
export class DockerService {
  private readonly docker = new Docker();
  private readonly dataRoot: string;
  private readonly image: string;

  constructor(configService: ConfigService) {
    this.dataRoot = configService.get<string>('MC_DATA_ROOT') ?? '/srv/mc';
    this.image =
      configService.get<string>('MC_IMAGE') ?? 'itzg/minecraft-server';
  }

  async create(opts: CreateContainerOptions): Promise<string> {
    const dataDir = path.join(this.dataRoot, opts.id, 'data');
    await mkdir(dataDir, { recursive: true });

    const container = await this.docker.createContainer({
      Image: this.image,
      name: `mc-server-${opts.id}`,
      Env: opts.env,
      ExposedPorts: { [CONTAINER_MC_PORT]: {} },
      HostConfig: {
        Binds: [`${dataDir}:/data`],
        PortBindings: {
          [CONTAINER_MC_PORT]: [{ HostPort: String(opts.port) }],
        },
        RestartPolicy: { Name: 'no' },
      },
    });
    return container.id;
  }

  async start(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).start();
  }

  async stop(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).stop();
    } catch (error) {
      if (!isStatus(error, 304)) throw error; // 304 = already stopped
    }
  }

  async restart(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).restart();
  }

  async remove(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove({ force: true });
    } catch (error) {
      if (!isStatus(error, 404)) throw error; // 404 = already gone
    }
  }

  async inspect(containerId: string): Promise<ContainerStatus> {
    const info = await this.docker.getContainer(containerId).inspect();
    return { running: info.State.Running, status: info.State.Status };
  }
}

function isStatus(error: unknown, code: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { statusCode?: number }).statusCode === code
  );
}
