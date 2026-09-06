import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { fetchMe } from './api';
import { useMe } from './hooks';

jest.mock('./api');

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

describe('useMe', () => {
  afterEach(() => jest.clearAllMocks());
  it('returns the session', async () => {
    (fetchMe as jest.Mock).mockResolvedValue({ username: 'admin' });
    const { result } = renderHook(() => useMe(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.username).toBe('admin'));
  });
});
