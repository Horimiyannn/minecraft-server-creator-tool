'use client';
import { useState } from 'react';
import { Button, Spinner } from '@ui';
import { errorText } from '@/lib/errors';
import { useFileContent, useSaveFile } from '../hooks';

export function FileEditor({
  serverId,
  path,
  onClose,
}: {
  serverId: string;
  path: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useFileContent(serverId, path);
  const save = useSaveFile(serverId);
  const [draft, setDraft] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (isError || !data)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-red-400">{errorText(error)}</p>
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
      </div>
    );

  const content = draft ?? data.content;
  const dirty = draft !== null && draft !== data.content;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{path}</span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              if (
                !dirty ||
                window.confirm('Discard unsaved changes to this file?')
              ) {
                onClose();
              }
            }}
          >
            Close
          </Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate({ path, content, mtimeMs: data.mtimeMs })
            }
          >
            Save
          </Button>
        </div>
      </div>
      <textarea
        aria-label={path}
        className="h-[28rem] w-full rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-sm"
        value={content}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
      {save.isError && <p className="text-red-400">{errorText(save.error)}</p>}
      <p className="text-xs text-neutral-500">
        Most settings are read when the server starts — restart it for changes
        to take effect.
      </p>
    </div>
  );
}
