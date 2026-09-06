import { api } from '@/lib/api-client';
import type { Session } from '@/types';

export function login(body: {
  username: string;
  password: string;
}): Promise<Session> {
  return api<Session>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function logout(): Promise<void> {
  return api<void>('/auth/logout', { method: 'POST' });
}

export function fetchMe(): Promise<Session> {
  return api<Session>('/auth/me');
}
