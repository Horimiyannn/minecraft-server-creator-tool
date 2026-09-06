'use client';
import { useEffect, useState } from 'react';
import type { ServerStats } from '@/types';
import { subscribeStats } from './socket';

export function useServerStats(serverId: string): ServerStats | null {
  const [state, setState] = useState<{ id: string; stats: ServerStats | null }>(
    { id: serverId, stats: null },
  );
  // Reset during render (not in the effect) when serverId changes, so we
  // never briefly show the previous server's stats — see react.dev's
  // "Adjusting state when a prop changes".
  const stats = state.id === serverId ? state.stats : null;

  useEffect(() => {
    return subscribeStats(serverId, (s) =>
      setState({ id: serverId, stats: s }),
    );
  }, [serverId]);

  return stats;
}
