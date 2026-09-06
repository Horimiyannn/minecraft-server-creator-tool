'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { QUERY_KEYS, ROUTES } from '@/constants';
import type { Session } from '@/types';
import { fetchMe, login, logout } from './api';

export function useMe() {
  return useQuery<Session>({ queryKey: QUERY_KEYS.me, queryFn: fetchMe });
}

export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: login,
    onSuccess: (session) => {
      qc.setQueryData(QUERY_KEYS.me, session);
      router.push(ROUTES.dashboard);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      qc.clear();
      router.push(ROUTES.login);
    },
  });
}
