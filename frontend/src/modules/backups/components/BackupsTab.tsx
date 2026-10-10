'use client';
import { useState } from 'react';
import { Button, ConfirmDialog, Spinner } from '@ui';
import { errorText } from '@/lib/errors';
import type { Backup } from '@/types';
import {
  useBackupActions,
  useBackupSchedule,
  useBackups,
  useCreateBackup,
} from '../hooks';
import { BackupList } from './BackupList';
import { ScheduleForm } from './ScheduleForm';

export function BackupsTab({ serverId }: { serverId: string }) {
  const { data: backups, isLoading, isError, error } = useBackups(serverId);
  const { data: schedule } = useBackupSchedule(serverId);
  const create = useCreateBackup(serverId);
  const actions = useBackupActions(serverId);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [deleting, setDeleting] = useState<Backup | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          disabled={create.isPending}
          onClick={() => create.mutate({ kind: 'world' })}
        >
          Back up world
        </Button>
        <Button
          variant="ghost"
          disabled={create.isPending}
          onClick={() => create.mutate({ kind: 'full' })}
        >
          Back up everything
        </Button>
      </div>
      {create.isError && (
        <p className="text-red-400">{errorText(create.error)}</p>
      )}
      {isLoading && <Spinner />}
      {isError && <p className="text-red-400">{errorText(error)}</p>}
      {backups && (
        <BackupList
          backups={backups}
          serverId={serverId}
          onRestore={setRestoring}
          onDelete={setDeleting}
        />
      )}
      {schedule && <ScheduleForm serverId={serverId} schedule={schedule} />}

      <ConfirmDialog
        open={restoring !== null}
        title="Restore this backup?"
        body={
          restoring?.kind === 'full'
            ? 'This stops the server and replaces every file in its data directory with the contents of this backup.'
            : 'This stops the server and replaces the world folders with the contents of this backup. Mods and configs are left alone.'
        }
        confirmLabel="Restore now"
        danger
        onCancel={() => setRestoring(null)}
        onConfirm={() => {
          if (restoring) actions.restore.mutate(restoring.id);
          setRestoring(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this backup?"
        body="The archive is removed from disk immediately."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) actions.remove.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
