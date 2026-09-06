'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import type { PublicServer, ServerDetail } from '@/types';
import {
  createServer,
  deleteServer,
  getServer,
  listServers,
  restartServer,
  startServer,
  stopServer,
} from './api';

export function useServers() {
  return useQuery<PublicServer[]>({
    queryKey: QUERY_KEYS.servers,
    queryFn: listServers,
  });
}

export function useServer(id: string) {
  return useQuery<ServerDetail>({
    queryKey: QUERY_KEYS.server(id),
    queryFn: () => getServer(id),
  });
}

export function useServerLifecycle() {
  const qc = useQueryClient();
  const invalidate = (id: string) => {
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.servers });
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.server(id) });
  };
  return {
    start: useMutation({
      mutationFn: startServer,
      onSuccess: (s) => invalidate(s.id),
    }),
    stop: useMutation({
      mutationFn: stopServer,
      onSuccess: (s) => invalidate(s.id),
    }),
    restart: useMutation({
      mutationFn: restartServer,
      onSuccess: (s) => invalidate(s.id),
    }),
  };
}

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.servers }),
  });
}

export function useDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.servers }),
  });
}
