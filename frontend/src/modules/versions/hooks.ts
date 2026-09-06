'use client';
import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import { fetchVersions } from './api';

export function useVersions(loader: string) {
  return useQuery<string[]>({
    queryKey: QUERY_KEYS.versions(loader),
    queryFn: () => fetchVersions(loader),
    enabled: Boolean(loader),
  });
}
