import { api } from '@/lib/api-client';
import { API_URL } from '@/constants';
import type { Backup, BackupKind, BackupSchedule } from '@/types';

const base = (serverId: string) => `/servers/${serverId}/backups`;

export const listBackups = (serverId: string) => api<Backup[]>(base(serverId));

export const createBackup = (
  serverId: string,
  body: { kind: BackupKind; label?: string },
) =>
  api<Backup>(base(serverId), { method: 'POST', body: JSON.stringify(body) });

export const deleteBackup = (serverId: string, backupId: string) =>
  api<{ ok: true }>(`${base(serverId)}/${backupId}`, { method: 'DELETE' });

export const restoreBackup = (serverId: string, backupId: string) =>
  api<{ ok: true }>(`${base(serverId)}/${backupId}/restore`, {
    method: 'POST',
  });

export const getSchedule = (serverId: string) =>
  api<BackupSchedule>(`${base(serverId)}/schedule`);

export const saveSchedule = (
  serverId: string,
  body: Omit<BackupSchedule, 'serverId'>,
) =>
  api<BackupSchedule>(`${base(serverId)}/schedule`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const backupDownloadUrl = (serverId: string, backupId: string) =>
  `${API_URL}${base(serverId)}/${backupId}/download`;
