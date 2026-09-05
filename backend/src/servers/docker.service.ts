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

interface CpuSnapshot {
  cpu_usage: { total_usage: number; percpu_usage?: number[] };
  system_cpu_usage?: number;
  online_cpus?: number;
}

export interface RawStats {
  cpu_stats: CpuSnapshot;
  precpu_stats: CpuSnapshot;
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: {
      cache?: number; // cgroup v1
      inactive_file?: number; // cgroup v2
      total_inactive_file?: number; // cgroup v1 (hierarchical)
    };
  };
}

const CONTAINER_MC_PORT = '25565/tcp';
const CONTAINER_RCON_PORT = '25575/tcp';

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
      Tty: true, // plain-text log stream (no stdout/stderr multiplexing)
      ExposedPorts: { [CONTAINER_MC_PORT]: {}, [CONTAINER_RCON_PORT]: {} },
      HostConfig: {
        Binds: [`${dataDir}:/data`],
        PortBindings: {
          [CONTAINER_MC_PORT]: [{ HostPort: String(opts.port) }],
          // RCON: loopback only, OS-assigned host port (read back via inspect).
          [CONTAINER_RCON_PORT]: [{ HostIp: '127.0.0.1', HostPort: '' }],
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

  dataDir(id: string): string {
    return path.join(this.dataRoot, id, 'data');
  }

  async logs(
    containerId: string,
    opts: { tail?: number } = {},
  ): Promise<NodeJS.ReadableStream> {
    const stream = await this.docker.getContainer(containerId).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: opts.tail ?? 200,
      timestamps: false,
    });
    return stream as unknown as NodeJS.ReadableStream;
  }

  async stats(containerId: string): Promise<RawStats> {
    const raw = await this.docker.getContainer(containerId).stats({
      stream: false,
    });
    return raw as unknown as RawStats;
  }

  async rconEndpoint(
    containerId: string,
  ): Promise<{ host: string; port: number }> {
    const info = await this.docker.getContainer(containerId).inspect();
    const binding = info.NetworkSettings?.Ports?.[CONTAINER_RCON_PORT]?.[0];
    if (!binding?.HostPort) {
      throw new Error('RCON port is not published for this container');
    }
    return { host: '127.0.0.1', port: Number(binding.HostPort) };
  }
}

function isStatus(error: unknown, code: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { statusCode?: number }).statusCode === code
  );
}
