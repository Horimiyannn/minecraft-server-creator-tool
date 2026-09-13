import type { Socket } from 'socket.io-client';
import { makeSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/constants';
import type { ServerStats } from '@/types';

type Listener = (stats: ServerStats) => void;

/**
 * How long a room (and the socket itself) is held open after its last
 * listener goes away. Switching tabs on the server page unmounts MetricsTab,
 * and without this grace window that tore the socket down and paid for a full
 * reconnect — plus a fresh backend poll loop — on the way back.
 */
const IDLE_GRACE_MS = 10_000;

let socket: Socket | null = null;
const listeners = new Map<string, Set<Listener>>();
/** Rooms we have emitted `join` for and not yet left. */
const joined = new Set<string>();
const pendingLeave = new Map<string, ReturnType<typeof setTimeout>>();
let pendingDisconnect: ReturnType<typeof setTimeout> | null = null;

function ensureSocket(): Socket {
  if (socket) return socket;
  const s = makeSocket('/metrics');
  socket = s;
  s.on(SOCKET_EVENTS.stats, (payload: ServerStats) => {
    listeners.get(payload.serverId)?.forEach((cb) => cb(payload));
  });
  s.on('connect', () => {
    // Server-side rooms are gone after a reconnect — re-join every room we
    // still consider ours.
    for (const serverId of joined) {
      s.emit(SOCKET_EVENTS.join, { serverId });
    }
  });
  return s;
}

function teardown(): void {
  for (const timer of pendingLeave.values()) clearTimeout(timer);
  pendingLeave.clear();
  joined.clear();
  socket?.disconnect();
  socket = null;
}

export function subscribeStats(serverId: string, cb: Listener): () => void {
  if (pendingDisconnect) {
    clearTimeout(pendingDisconnect);
    pendingDisconnect = null;
  }
  const leaveTimer = pendingLeave.get(serverId);
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    pendingLeave.delete(serverId);
  }

  const s = ensureSocket();
  let set = listeners.get(serverId);
  if (!set) {
    set = new Set();
    listeners.set(serverId, set);
  }
  set.add(cb);
  // Only join a room we are not already in: a remount inside the grace window
  // never left it.
  if (!joined.has(serverId)) {
    joined.add(serverId);
    s.emit(SOCKET_EVENTS.join, { serverId });
  }

  return () => {
    const current = listeners.get(serverId);
    if (!current || !current.has(cb)) return; // already released
    current.delete(cb);
    if (current.size > 0) return;
    listeners.delete(serverId);

    pendingLeave.set(
      serverId,
      setTimeout(() => {
        pendingLeave.delete(serverId);
        joined.delete(serverId);
        socket?.emit(SOCKET_EVENTS.leave, { serverId });
      }, IDLE_GRACE_MS),
    );
    if (listeners.size === 0 && !pendingDisconnect) {
      pendingDisconnect = setTimeout(() => {
        pendingDisconnect = null;
        teardown();
      }, IDLE_GRACE_MS);
    }
  };
}
