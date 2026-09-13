import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useFiles } from './hooks';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useFiles', () => {
  it('fetches the directory listing for a path', async () => {
    const entries = [{ name: 'mods', type: 'dir', sizeBytes: 0, mtimeMs: 1 }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(entries),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useFiles('s1', 'config'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(entries));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/servers/s1/files?path=config'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
