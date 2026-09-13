export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const ROUTES = {
  login: '/login',
  dashboard: '/',
  server: (id: string) => `/servers/${id}`,
} as const;

export const QUERY_KEYS = {
  me: ['me'] as const,
  servers: ['servers'] as const,
  server: (id: string) => ['servers', id] as const,
  versions: (loader: string) => ['versions', loader] as const,
  builds: (loader: string, mcVersion: string) =>
    ['versions', loader, 'builds', mcVersion] as const,
};

export const SOCKET_EVENTS = {
  join: 'join',
  leave: 'leave',
  command: 'command',
  log: 'log',
  output: 'output',
  error: 'error',
  stats: 'stats',
} as const;

export const LOADERS = ['vanilla', 'paper', 'forge', 'neoforge'] as const;
