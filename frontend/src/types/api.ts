import type { LOADERS } from '@/constants';

export type Loader = (typeof LOADERS)[number];
export type ServerStatus = 'creating' | 'running' | 'stopped' | 'failed';

export interface PublicServer {
  id: string;
  name: string;
  loader: Loader;
  version: string;
  ramMb: number;
  port: number;
  containerId: string | null;
  status: ServerStatus;
  createdAt: string;
}

export interface ServerDetail extends PublicServer {
  live: { running: boolean; status: string } | null;
}

export interface Session {
  id: string;
  username: string;
}

export interface ServerStats {
  serverId: string;
  cpuPct: number;
  memUsedMb: number;
  memLimitMb: number;
  diskMb: number;
}

export interface ConsoleLog {
  serverId: string;
  line: string;
}
export interface ConsoleOutput {
  serverId: string;
  output: string;
}
