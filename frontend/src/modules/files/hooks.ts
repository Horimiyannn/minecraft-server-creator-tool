'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import type { FileContent, FileEntry } from '@/types';
import {
  compressPaths,
  deletePaths,
  extractArchive,
  listFiles,
  makeDir,
  readFile,
  renamePath,
  searchFiles,
  uploadFile,
  writeFile,
} from './api';

export function useFiles(serverId: string, path: string) {
  return useQuery<FileEntry[]>({
    queryKey: QUERY_KEYS.files(serverId, path),
    queryFn: () => listFiles(serverId, path),
  });
}

export function useFileContent(serverId: string, path: string | null) {
  return useQuery<FileContent>({
    queryKey: QUERY_KEYS.fileContent(serverId, path ?? ''),
    queryFn: () => readFile(serverId, path as string),
    enabled: path !== null,
  });
}

export function useSaveFile(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { path: string; content: string; mtimeMs?: number }) =>
      writeFile(serverId, body),
    onSuccess: (_result, body) =>
      qc.invalidateQueries({
        queryKey: QUERY_KEYS.fileContent(serverId, body.path),
      }),
  });
}

export function useFileOps(serverId: string, path: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ['servers', serverId, 'files'] });
  return {
    mkdir: useMutation({
      mutationFn: (dir: string) => makeDir(serverId, dir),
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: (args: { from: string; to: string }) =>
        renamePath(serverId, args.from, args.to),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (paths: string[]) => deletePaths(serverId, paths),
      onSuccess: invalidate,
    }),
    extract: useMutation({
      mutationFn: (args: { path: string; dest: string }) =>
        extractArchive(serverId, args.path, args.dest),
      onSuccess: invalidate,
    }),
    compress: useMutation({
      mutationFn: (args: { paths: string[]; dest: string }) =>
        compressPaths(serverId, args.paths, args.dest),
      onSuccess: invalidate,
    }),
    upload: useMutation({
      mutationFn: (file: File) => uploadFile(serverId, path, file),
      onSuccess: invalidate,
    }),
  };
}

export function useFileSearch(serverId: string, q: string) {
  return useQuery<string[]>({
    queryKey: ['servers', serverId, 'file-search', q],
    queryFn: () => searchFiles(serverId, q),
    enabled: q.length >= 2,
  });
}
