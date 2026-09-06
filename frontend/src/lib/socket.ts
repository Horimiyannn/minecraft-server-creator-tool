import { io, type Socket } from 'socket.io-client';
import { API_URL } from '@/constants';

export function makeSocket(namespace: '/console' | '/metrics'): Socket {
  return io(`${API_URL}${namespace}`, {
    withCredentials: true,
    transports: ['websocket'],
    forceNew: true,
  });
}
