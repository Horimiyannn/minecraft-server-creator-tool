import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { QUERY_KEYS } from '@/constants';
import * as serversApi from './api';
import { useServers, useServerLifecycle } from './hooks';

jest.mock('./api');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return { client, wrapper: Wrapper };
}

describe('servers hooks', () => {
  afterEach(() => jest.clearAllMocks());

  it('useServers returns the list', async () => {
    (serversApi.listServers as jest.Mock).mockResolvedValue([
      { id: 's1', name: 'a' },
    ]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it('lifecycle start invalidates the servers query', async () => {
    (serversApi.startServer as jest.Mock).mockResolvedValue({ id: 's1' });
    const { client, wrapper } = makeWrapper();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useServerLifecycle(), { wrapper });
    await act(async () => {
      await result.current.start.mutateAsync('s1');
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.servers });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: QUERY_KEYS.server('s1'),
    });
  });
});
