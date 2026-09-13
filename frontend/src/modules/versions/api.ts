import { api } from '@/lib/api-client';

interface VersionList {
  loader: string;
  versions: string[];
}

interface BuildList {
  loader: string;
  mcVersion: string;
  builds: string[];
}

export const fetchVersions = (loader: string): Promise<string[]> =>
  api<VersionList>(`/versions/${loader}`).then((r) => r.versions);

/** Exact loader builds (e.g. Forge 47.x) available for one MC version. */
export const fetchBuilds = (
  loader: string,
  mcVersion: string,
): Promise<string[]> =>
  api<BuildList>(`/versions/${loader}/builds/${mcVersion}`).then(
    (r) => r.builds,
  );
