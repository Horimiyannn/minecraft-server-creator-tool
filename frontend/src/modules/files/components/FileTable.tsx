'use client';
import { Checkbox } from '@ui';
import type { FileEntry } from '@/types';
import { downloadUrl } from '../api';
import { DownloadIcon, PencilIcon, TrashIcon } from './icons';

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

// One hover colour per button: two competing hover:text-* classes would be
// resolved by stylesheet order, not by the order written here.
const iconButton =
  'inline-flex rounded p-1 text-neutral-400 hover:bg-neutral-700';
const neutralIcon = `${iconButton} hover:text-white`;
const dangerIcon = `${iconButton} hover:text-red-400`;

export function FileTable({
  entries,
  selected,
  onToggle,
  onOpen,
  onRename,
  onDelete,
  serverId,
  basePath = '',
}: {
  entries: FileEntry[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onOpen: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  serverId: string;
  basePath?: string;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-neutral-500">
        <tr>
          <th className="w-10" />
          <th>Name</th>
          <th className="w-28">Size</th>
          <th className="w-44">Modified</th>
          <th className="w-20" />
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          // Hover lights the whole row so the target of an action is obvious;
          // even rows are faintly striped to keep long listings readable.
          <tr
            key={entry.name}
            className="border-t border-neutral-800 transition-colors even:bg-neutral-900/60 hover:bg-neutral-800"
          >
            <td className="py-1.5 pl-2">
              <Checkbox
                checked={selected.has(entry.name)}
                onChange={() => onToggle(entry.name)}
              />
            </td>
            <td className="py-1.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => onOpen(entry)}
                >
                  {entry.type === 'dir' && <span aria-hidden="true">📁 </span>}
                  {entry.name}
                </button>
                <button
                  type="button"
                  className={neutralIcon}
                  aria-label={`Rename ${entry.name}`}
                  title="Rename"
                  onClick={() => onRename(entry)}
                >
                  <PencilIcon />
                </button>
              </div>
            </td>
            <td className="py-1.5">
              {entry.type === 'dir' ? '—' : humanSize(entry.sizeBytes)}
            </td>
            <td className="py-1.5">
              {new Date(entry.mtimeMs).toLocaleString()}
            </td>
            <td className="py-1.5 pr-2">
              <div className="flex items-center justify-end gap-1">
                <a
                  className={neutralIcon}
                  aria-label={`Download ${entry.name}`}
                  title="Download"
                  href={downloadUrl(
                    serverId,
                    basePath ? `${basePath}/${entry.name}` : entry.name,
                  )}
                >
                  <DownloadIcon />
                </a>
                <button
                  type="button"
                  className={dangerIcon}
                  aria-label={`Delete ${entry.name}`}
                  title="Delete"
                  onClick={() => onDelete(entry)}
                >
                  <TrashIcon />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
