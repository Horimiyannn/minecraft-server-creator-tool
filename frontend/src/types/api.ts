import type { LOADERS } from '@/constants';

export type Loader = (typeof LOADERS)[number];
export type ServerStatus = 'creating' | 'running' | 'stopped' | 'failed';

export interface PublicServer {
  id: string;
  name: string;
  loader: Loader;
  version: string;
  loaderVersion: string | null;
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

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  sizeBytes: number;
  mtimeMs: number;
}

export interface FileContent {
  content: string;
  mtimeMs: number;
}

export interface BulkResult {
  path: string;
  ok: boolean;
  error?: string;
}

export type BackupKind = 'world' | 'full';
export type BackupTrigger = 'manual' | 'chat' | 'schedule';

export interface Backup {
  id: string;
  serverId: string;
  kind: BackupKind;
  trigger: BackupTrigger;
  label: string | null;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupSchedule {
  serverId: string;
  worldEveryMin: number | null;
  fullEveryMin: number | null;
  keepWorld: number;
  keepFull: number;
  skipWhenEmpty: boolean;
  chatEnabled: boolean;
}
