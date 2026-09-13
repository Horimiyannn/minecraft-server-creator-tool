import * as path from 'node:path';

export function serverRoot(dataRoot: string, id: string): string {
  return path.join(dataRoot, id);
}

export function dataDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'data');
}

// Consumed by the backups plan (docs/superpowers/plans/2026-09-12-backups.md).
// fallow-ignore-next-line unused-export
export function backupsDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'backups');
}

// Consumed by the pack-install plan (docs/superpowers/plans/2026-09-12-pack-install.md).
// fallow-ignore-next-line unused-export
export function stagingDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'staging');
}
