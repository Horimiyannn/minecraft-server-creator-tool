import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useBackups } from './hooks';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useBackups', () => {
  it('lists backups for a server', async () => {
    const rows = [
      {
        id: 'b1',
        serverId: 's1',
        kind: 'world',
        trigger: 'chat',
        label: null,
        sizeBytes: 1024,
        createdAt: '2026-09-12T10:00:00.000Z',
      },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(rows),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useBackups('s1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(rows));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/servers/s1/backups'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
