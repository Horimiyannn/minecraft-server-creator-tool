'use client';
import { Checkbox } from '@ui';
import type { FileEntry } from '@/types';
import { downloadUrl } from '../api';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function FileTable({
  entries,
  selected,
  onToggle,
  onOpen,
  serverId,
  basePath = '',
}: {
  entries: FileEntry[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onOpen: (entry: FileEntry) => void;
  serverId: string;
  basePath?: string;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-neutral-500">
        <tr>
          <th className="w-8" />
          <th>Name</th>
          <th className="w-28">Size</th>
          <th className="w-44">Modified</th>
          <th className="w-20" />
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.name} className="border-t border-neutral-800">
            <td>
              <Checkbox
                checked={selected.has(entry.name)}
                onChange={() => onToggle(entry.name)}
              />
            </td>
            <td>
              <button
                type="button"
                className="hover:underline"
                onClick={() => onOpen(entry)}
              >
                {entry.type === 'dir' && <span aria-hidden="true">📁 </span>}
                {entry.name}
              </button>
            </td>
            <td>{entry.type === 'dir' ? '—' : humanSize(entry.sizeBytes)}</td>
            <td>{new Date(entry.mtimeMs).toLocaleString()}</td>
            <td>
              <a
                className="text-neutral-400 hover:text-white"
                href={downloadUrl(
                  serverId,
                  basePath ? `${basePath}/${entry.name}` : entry.name,
                )}
              >
                Download
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
