'use client';
import { Badge, Button } from '@ui';
import type { Backup, BackupTrigger } from '@/types';
import { backupDownloadUrl } from '../api';

const TRIGGER_TONES: Record<BackupTrigger, 'green' | 'gray' | 'yellow'> = {
  manual: 'gray',
  chat: 'green',
  schedule: 'yellow',
};

function humanSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function age(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

export function BackupList({
  backups,
  serverId,
  busy = false,
  onRestore,
  onDelete,
}: {
  backups: Backup[];
  serverId: string;
  /** A restore or delete is in flight: a second click would 409. */
  busy?: boolean;
  onRestore: (backup: Backup) => void;
  onDelete: (backup: Backup) => void;
}) {
  if (backups.length === 0) {
    return <p className="text-sm text-neutral-500">No backups yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-neutral-500">
        <tr>
          <th className="font-medium">Kind</th>
          <th className="font-medium">Trigger</th>
          <th className="font-medium">Label</th>
          <th className="font-medium">Size</th>
          <th className="font-medium">Age</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {backups.map((backup) => (
          <tr key={backup.id} className="border-t border-neutral-800">
            <td>{backup.kind}</td>
            <td>
              <Badge tone={TRIGGER_TONES[backup.trigger]}>
                {backup.trigger}
              </Badge>
            </td>
            <td>{backup.label ?? '—'}</td>
            <td>{humanSize(backup.sizeBytes)}</td>
            <td>{age(backup.createdAt)}</td>
            <td className="flex gap-2 py-1">
              <a
                className="self-center text-neutral-400 hover:text-white"
                href={backupDownloadUrl(serverId, backup.id)}
              >
                Download
              </a>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onRestore(backup)}
              >
                Restore
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onDelete(backup)}
              >
                Delete
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
