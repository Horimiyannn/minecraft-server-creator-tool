import type { Socket } from 'socket.io-client';
import { makeSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/constants';
import type { ServerStats } from '@/types';

type Listener = (stats: ServerStats) => void;

let socket: Socket | null = null;
const listeners = new Map<string, Set<Listener>>();

function ensureSocket(): Socket {
  if (socket) return socket;
  socket = makeSocket('/metrics');
  socket.on(SOCKET_EVENTS.stats, (payload: ServerStats) => {
    listeners.get(payload.serverId)?.forEach((cb) => cb(payload));
  });
  socket.on('connect', () => {
    // Re-join every active room after a (re)connect.
    for (const serverId of listeners.keys()) {
      socket?.emit(SOCKET_EVENTS.join, { serverId });
    }
  });
  return socket;
}

export function subscribeStats(serverId: string, cb: Listener): () => void {
  const s = ensureSocket();
  let set = listeners.get(serverId);
  if (!set) {
    set = new Set();
    listeners.set(serverId, set);
    s.emit(SOCKET_EVENTS.join, { serverId });
  }
  set.add(cb);

  return () => {
    const cur = listeners.get(serverId);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) {
      listeners.delete(serverId);
      s.emit(SOCKET_EVENTS.leave, { serverId });
    }
    if (listeners.size === 0) {
      s.disconnect();
      socket = null;
    }
  };
}

// ponytail: one shared /metrics socket, ref-counted rooms; disconnect on zero listeners. If unmount/remount churn causes reconnect thrash, add a short idle grace timer before disconnect.
