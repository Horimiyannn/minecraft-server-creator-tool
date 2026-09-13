import { api } from '@/lib/api-client';
import { API_URL } from '@/constants';
import type { BulkResult, FileContent, FileEntry } from '@/types';

const base = (serverId: string) => `/servers/${serverId}/files`;

export const listFiles = (serverId: string, path: string) =>
  api<FileEntry[]>(`${base(serverId)}?path=${encodeURIComponent(path)}`);

export const readFile = (serverId: string, path: string) =>
  api<FileContent>(
    `${base(serverId)}/content?path=${encodeURIComponent(path)}`,
  );

export const writeFile = (
  serverId: string,
  body: { path: string; content: string; mtimeMs?: number },
) =>
  api<{ mtimeMs: number }>(`${base(serverId)}/content`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const makeDir = (serverId: string, path: string) =>
  api<{ ok: true }>(`${base(serverId)}/dir`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

export const createFile = (serverId: string, path: string) =>
  api<{ ok: true }>(`${base(serverId)}/file`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

export const renamePath = (serverId: string, from: string, to: string) =>
  api<{ ok: true }>(`${base(serverId)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });

export const deletePaths = (serverId: string, paths: string[]) =>
  api<BulkResult[]>(`${base(serverId)}/delete`, {
    method: 'POST',
    body: JSON.stringify({ paths }),
  });

export const searchFiles = (serverId: string, q: string) =>
  api<string[]>(`${base(serverId)}/search?q=${encodeURIComponent(q)}`);

export const extractArchive = (serverId: string, path: string, dest: string) =>
  api<{ ok: true }>(`${base(serverId)}/extract`, {
    method: 'POST',
    body: JSON.stringify({ path, dest }),
  });

export const compressPaths = (
  serverId: string,
  paths: string[],
  dest: string,
) =>
  api<{ ok: true }>(`${base(serverId)}/compress`, {
    method: 'POST',
    body: JSON.stringify({ paths, dest }),
  });

/** Multipart upload bypasses `api()` — it must not set a JSON content type. */
export async function uploadFile(
  serverId: string,
  destDir: string,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(
    `${API_URL}${base(serverId)}/upload?path=${encodeURIComponent(destDir)}`,
    { method: 'POST', credentials: 'include', body: form },
  );
  if (!res.ok) throw new Error(await res.text());
}

export const downloadUrl = (serverId: string, path: string) =>
  `${API_URL}${base(serverId)}/download?path=${encodeURIComponent(path)}`;
