'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { makeSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/constants';
import type { ConsoleLog, ConsoleOutput } from '@/types';

const MAX_LINES = 2000;

export function useConsole(serverId: string) {
  const socketRef = useRef<Socket | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  const append = useCallback((line: string) => {
    setLines((prev) => {
      const next = prev.length >= MAX_LINES ? prev.slice(1) : prev;
      return [...next, line];
    });
  }, []);

  useEffect(() => {
    const socket = makeSocket('/console');
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(SOCKET_EVENTS.join, { serverId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on(SOCKET_EVENTS.log, (p: ConsoleLog) => append(p.line));
    socket.on(SOCKET_EVENTS.output, (p: ConsoleOutput) => append(p.output));
    socket.on(SOCKET_EVENTS.error, (p: { message: string }) =>
      append(`[error] ${p.message}`),
    );

    return () => {
      socket.emit(SOCKET_EVENTS.leave, { serverId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverId, append]);

  const send = useCallback(
    (command: string) => {
      socketRef.current?.emit(SOCKET_EVENTS.command, { serverId, command });
    },
    [serverId],
  );

  return { lines, send, connected };
}
