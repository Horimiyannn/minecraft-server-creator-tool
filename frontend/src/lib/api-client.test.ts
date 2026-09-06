import { api, ApiError } from './api-client';

function fakeResponse(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => body,
  } as Response;
}

describe('api', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends credentials and returns parsed json', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        fakeResponse(200, JSON.stringify({ ok: true })),
      ) as jest.Mock;
    const result = await api<{ ok: boolean }>('/health');
    expect(result).toEqual({ ok: true });
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.credentials).toBe('include');
  });

  it('throws ApiError with status on non-2xx', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse(401, 'nope')) as jest.Mock;
    await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/auth/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
  });

  it('returns undefined for 204 no-content', async () => {
    global.fetch = jest.fn().mockResolvedValue(fakeResponse(204)) as jest.Mock;
    await expect(
      api('/servers/x', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });
});
