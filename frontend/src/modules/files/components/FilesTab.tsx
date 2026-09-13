'use client';
import { useState } from 'react';
import { Button, ConfirmDialog, Spinner } from '@ui';
import { errorText } from '@/lib/errors';
import type { FileEntry } from '@/types';
import { useFileOps, useFiles } from '../hooks';
import { Breadcrumb } from './Breadcrumb';
import { FileEditor } from './FileEditor';
import { FileTable } from './FileTable';
import { FileToolbar } from './FileToolbar';

export function FilesTab({ serverId }: { serverId: string }) {
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Names in the current folder waiting on delete confirmation. */
  const [pendingDelete, setPendingDelete] = useState<string[]>([]);
  const [failedDeletes, setFailedDeletes] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const { data: entries, isLoading, isError } = useFiles(serverId, path);
  const ops = useFileOps(serverId, path);

  const join = (name: string) => (path ? `${path}/${name}` : name);
  const opError = ops.rename.error ?? ops.remove.error;

  function navigate(next: string): void {
    setSelected(new Set());
    setFailedDeletes([]);
    setPath(next);
  }

  function toggle(name: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function open(entry: FileEntry): void {
    if (entry.type === 'dir') navigate(join(entry.name));
    else setEditing(join(entry.name));
  }

  function rename(entry: FileEntry): void {
    const next = window.prompt(`Rename ${entry.name} to`, entry.name)?.trim();
    if (!next || next === entry.name) return;
    ops.rename.mutate(
      { from: join(entry.name), to: join(next) },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  function confirmDelete(): void {
    const names = pendingDelete;
    setPendingDelete([]);
    ops.remove.mutate(names.map(join), {
      onSuccess: (results) => {
        setSelected(new Set());
        // Bulk delete reports per path; surface the ones that did not go.
        setFailedDeletes(
          results.filter((result) => !result.ok).map((result) => result.path),
        );
      },
    });
  }

  if (editing !== null) {
    return (
      <FileEditor
        serverId={serverId}
        path={editing}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Breadcrumb path={path} onNavigate={navigate} />
        {selected.size > 0 && (
          <Button
            variant="danger"
            onClick={() => setPendingDelete([...selected])}
          >
            Delete {selected.size}
          </Button>
        )}
      </div>
      <FileToolbar
        serverId={serverId}
        path={path}
        selected={selected}
        onOpenFile={setEditing}
      />
      {opError && <p className="text-sm text-red-400">{errorText(opError)}</p>}
      {failedDeletes.length > 0 && (
        <p className="text-sm text-red-400">
          Could not delete: {failedDeletes.join(', ')}
        </p>
      )}
      {isLoading && <Spinner />}
      {isError && <p className="text-red-400">Could not read this folder.</p>}
      {entries && (
        <FileTable
          entries={entries}
          selected={selected}
          onToggle={toggle}
          onOpen={open}
          onRename={rename}
          onDelete={(entry) => setPendingDelete([entry.name])}
          serverId={serverId}
          basePath={path}
        />
      )}
      <ConfirmDialog
        open={pendingDelete.length > 0}
        title={
          pendingDelete.length === 1
            ? `Delete ${pendingDelete[0]}?`
            : `Delete ${pendingDelete.length} items?`
        }
        body="Deleted files are gone immediately. The server may still hold open files it is using."
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete([])}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
