'use client';
import { useState } from 'react';
import { Button, ConfirmDialog, Spinner } from '@ui';
import type { FileEntry } from '@/types';
import { useFileOps, useFiles } from '../hooks';
import { Breadcrumb } from './Breadcrumb';
import { FileEditor } from './FileEditor';
import { FileTable } from './FileTable';
import { FileToolbar } from './FileToolbar';

export function FilesTab({ serverId }: { serverId: string }) {
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { data: entries, isLoading, isError } = useFiles(serverId, path);
  const ops = useFileOps(serverId, path);

  const join = (name: string) => (path ? `${path}/${name}` : name);

  function navigate(next: string): void {
    setSelected(new Set());
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
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete {selected.size}
          </Button>
        )}
      </div>
      <FileToolbar
        serverId={serverId}
        path={path}
        selected={selected}
        onSearchSelect={setEditing}
      />
      {isLoading && <Spinner />}
      {isError && <p className="text-red-400">Could not read this folder.</p>}
      {entries && (
        <FileTable
          entries={entries}
          selected={selected}
          onToggle={toggle}
          onOpen={open}
          serverId={serverId}
          basePath={path}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${selected.size} item(s)?`}
        body="Deleted files are gone immediately. The server may still hold open files it is using."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          ops.remove.mutate([...selected].map(join), {
            onSuccess: () => setSelected(new Set()),
          });
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}
