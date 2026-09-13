'use client';
import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import { fetchBuilds, fetchVersions } from './api';

export function useVersions(loader: string) {
  return useQuery<string[]>({
    queryKey: QUERY_KEYS.versions(loader),
    queryFn: () => fetchVersions(loader),
    enabled: Boolean(loader),
  });
}

/** Vanilla has no loader jar, so it is never queried. */
export function useLoaderBuilds(loader: string, mcVersion: string) {
  return useQuery<string[]>({
    queryKey: QUERY_KEYS.builds(loader, mcVersion),
    queryFn: () => fetchBuilds(loader, mcVersion),
    enabled: Boolean(loader) && loader !== 'vanilla' && Boolean(mcVersion),
  });
}
