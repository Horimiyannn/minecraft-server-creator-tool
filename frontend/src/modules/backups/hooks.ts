'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import type { Backup, BackupKind, BackupSchedule } from '@/types';
import {
  createBackup,
  deleteBackup,
  getSchedule,
  listBackups,
  restoreBackup,
  saveSchedule,
} from './api';

export function useBackups(serverId: string) {
  return useQuery<Backup[]>({
    queryKey: QUERY_KEYS.backups(serverId),
    queryFn: () => listBackups(serverId),
  });
}

export function useCreateBackup(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: BackupKind; label?: string }) =>
      createBackup(serverId, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: QUERY_KEYS.backups(serverId) }),
  });
}

export function useBackupActions(serverId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.backups(serverId) });
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.server(serverId) });
  };
  return {
    remove: useMutation({
      mutationFn: (backupId: string) => deleteBackup(serverId, backupId),
      onSuccess: invalidate,
    }),
    restore: useMutation({
      mutationFn: (backupId: string) => restoreBackup(serverId, backupId),
      onSuccess: invalidate,
    }),
  };
}

export function useBackupSchedule(serverId: string) {
  return useQuery<BackupSchedule>({
    queryKey: QUERY_KEYS.backupSchedule(serverId),
    queryFn: () => getSchedule(serverId),
  });
}

export function useSaveBackupSchedule(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<BackupSchedule, 'serverId'>) =>
      saveSchedule(serverId, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: QUERY_KEYS.backupSchedule(serverId) }),
  });
}
