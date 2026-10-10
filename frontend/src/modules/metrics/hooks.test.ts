import { renderHook, act, waitFor } from '@testing-library/react';
import * as socketMod from './socket';
import { useServerStats } from './hooks';
import type { ServerStats } from '@/types';

jest.mock('./socket');

describe('useServerStats', () => {
  afterEach(() => jest.restoreAllMocks());

  it('updates on a stats event and unsubscribes on unmount', async () => {
    let emit: (s: ServerStats) => void = () => {};
    const unsub = jest.fn();
    (socketMod.subscribeStats as jest.Mock).mockImplementation((_id, cb) => {
      emit = cb;
      return unsub;
    });

    const { result, unmount } = renderHook(() => useServerStats('s1'));
    expect(result.current).toBeNull();

    act(() => {
      emit({
        serverId: 's1',
        cpuPct: 40,
        memUsedMb: 300,
        memLimitMb: 2048,
        diskMb: 12,
        backupsMb: 4,
      });
    });
    await waitFor(() => expect(result.current?.cpuPct).toBe(40));

    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});
