import * as path from 'node:path';

export function serverRoot(dataRoot: string, id: string): string {
  return path.join(dataRoot, id);
}

export function dataDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'data');
}

export function backupsDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'backups');
}

export function stagingDir(dataRoot: string, id: string): string {
  return path.join(serverRoot(dataRoot, id), 'staging');
}
