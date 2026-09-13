import { api } from '@/lib/api-client';
import type { PublicServer, ServerDetail, Loader } from '@/types';

export interface CreateServerBody {
  name: string;
  loader: Loader;
  version: string;
  /** Omitted to let the backend resolve the latest loader build. */
  loaderVersion?: string;
  ramMb: number;
  port: number;
}

export const listServers = () => api<PublicServer[]>('/servers');
export const getServer = (id: string) => api<ServerDetail>(`/servers/${id}`);
export const createServer = (body: CreateServerBody) =>
  api<PublicServer>('/servers', { method: 'POST', body: JSON.stringify(body) });
export const startServer = (id: string) =>
  api<PublicServer>(`/servers/${id}/start`, { method: 'POST' });
export const stopServer = (id: string) =>
  api<PublicServer>(`/servers/${id}/stop`, { method: 'POST' });
export const restartServer = (id: string) =>
  api<PublicServer>(`/servers/${id}/restart`, { method: 'POST' });
export const deleteServer = (id: string) =>
  api<void>(`/servers/${id}`, { method: 'DELETE' });
