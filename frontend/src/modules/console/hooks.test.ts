import { renderHook, act, waitFor } from '@testing-library/react';
import * as socketLib from '@/lib/socket';
import { useConsole } from './hooks';

jest.mock('@/lib/socket');

type Handler = (payload: unknown) => void;

function makeFakeSocket() {
  const handlers: Record<string, Handler[]> = {};
  const sent: { event: string; payload: unknown }[] = [];
  return {
    on(event: string, cb: Handler) {
      (handlers[event] ??= []).push(cb);
    },
    emit(event: string, payload?: unknown) {
      sent.push({ event, payload });
    },
    disconnect: jest.fn(),
    fire(event: string, payload?: unknown) {
      (handlers[event] ?? []).forEach((cb) => cb(payload));
    },
    sent,
  };
}

describe('useConsole', () => {
  afterEach(() => jest.restoreAllMocks());

  it('joins on connect, appends lines, sends commands, leaves on unmount', async () => {
    const fake = makeFakeSocket();
    (socketLib.makeSocket as jest.Mock).mockReturnValue(fake as never);

    const { result, unmount } = renderHook(() => useConsole('s1'));

    act(() => fake.fire('connect'));
    expect(fake.sent).toContainEqual({
      event: 'join',
      payload: { serverId: 's1' },
    });

    act(() => fake.fire('log', { serverId: 's1', line: 'Server started!' }));
    await waitFor(() =>
      expect(result.current.lines).toContain('Server started!'),
    );

    act(() => result.current.send('list'));
    expect(fake.sent).toContainEqual({
      event: 'command',
      payload: { serverId: 's1', command: 'list' },
    });

    act(() => fake.fire('output', { serverId: 's1', output: '0 players' }));
    await waitFor(() => expect(result.current.lines).toContain('0 players'));

    unmount();
    expect(fake.sent).toContainEqual({
      event: 'leave',
      payload: { serverId: 's1' },
    });
    expect(fake.disconnect).toHaveBeenCalled();
  });
});
