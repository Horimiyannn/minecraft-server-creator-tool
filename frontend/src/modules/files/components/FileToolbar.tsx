'use client';
import { useRef, useState } from 'react';
import { Button, Input } from '@ui';
import { errorText } from '@/lib/errors';
import { useFileOps, useFileSearch } from '../hooks';

export function FileToolbar({
  serverId,
  path,
  selected,
  onSearchSelect,
}: {
  serverId: string;
  path: string;
  selected: Set<string>;
  onSearchSelect: (path: string) => void;
}) {
  const ops = useFileOps(serverId, path);
  const [query, setQuery] = useState('');
  const { data: hits } = useFileSearch(serverId, query);
  const fileInput = useRef<HTMLInputElement>(null);

  const join = (name: string) => (path ? `${path}/${name}` : name);
  const selectedPaths = [...selected].map(join);
  const failed = Object.values(ops).find((op) => op.isError);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) ops.upload.mutate(file);
            e.target.value = '';
          }}
        />
        <Button
          loading={ops.upload.isPending}
          onClick={() => fileInput.current?.click()}
        >
          Upload
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const name = window.prompt('Folder name');
            if (name) ops.mkdir.mutate(join(name));
          }}
        >
          New folder
        </Button>
        {selected.size === 1 &&
          [...selected][0].toLowerCase().endsWith('.zip') && (
            <Button
              variant="ghost"
              loading={ops.extract.isPending}
              onClick={() =>
                ops.extract.mutate({ path: selectedPaths[0], dest: path })
              }
            >
              Extract
            </Button>
          )}
        {selected.size > 0 && (
          <Button
            variant="ghost"
            loading={ops.compress.isPending}
            onClick={() => {
              const name = window.prompt('Archive name', 'archive.zip');
              if (name)
                ops.compress.mutate({ paths: selectedPaths, dest: join(name) });
            }}
          >
            Compress
          </Button>
        )}
        <div className="relative ml-auto">
          <Input
            aria-label="Search files"
            placeholder="Search files"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {hits && hits.length > 0 && query.length >= 2 && (
            <ul className="absolute right-0 z-10 mt-1 max-h-48 w-80 overflow-auto rounded border border-neutral-800 bg-neutral-900 text-sm">
              {hits.map((hit) => (
                <li key={hit}>
                  <button
                    type="button"
                    className="w-full px-2 py-1 text-left hover:bg-neutral-800"
                    onClick={() => {
                      setQuery('');
                      onSearchSelect(hit);
                    }}
                  >
                    {hit}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {failed && (
        <p className="text-sm text-red-400">{errorText(failed.error)}</p>
      )}
    </div>
  );
}
