import { api } from '@/lib/api-client';

interface VersionList {
  loader: string;
  versions: string[];
}

export const fetchVersions = (loader: string): Promise<string[]> =>
  api<VersionList>(`/versions/${loader}`).then((r) => r.versions);
