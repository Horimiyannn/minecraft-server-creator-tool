import { api } from '@/lib/api-client';

export const fetchVersions = (loader: string) =>
  api<string[]>(`/versions/${loader}`);
