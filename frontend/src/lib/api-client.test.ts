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

  it('lifts the backend error code onto ApiError', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeResponse(
        409,
        JSON.stringify({
          code: 'PORT_IN_USE',
          message: 'Port 25565 is already in use on this host',
          statusCode: 409,
        }),
      ),
    ) as jest.Mock;
    await expect(api('/servers')).rejects.toMatchObject({
      status: 409,
      code: 'PORT_IN_USE',
      message: 'Port 25565 is already in use on this host',
    });
  });

  it('flattens a class-validator message array', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeResponse(
        400,
        JSON.stringify({
          statusCode: 400,
          message: ['name must be 1-32 chars', 'port must be an integer'],
        }),
      ),
    ) as jest.Mock;
    await expect(api('/servers')).rejects.toMatchObject({
      status: 400,
      code: undefined,
      message: 'name must be 1-32 chars, port must be an integer',
    });
  });

  it('falls back to the raw body when it is not JSON', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        fakeResponse(502, '<html>bad gateway</html>'),
      ) as jest.Mock;
    await expect(api('/servers')).rejects.toMatchObject({
      status: 502,
      message: '<html>bad gateway</html>',
    });
  });

  it('returns undefined for 204 no-content', async () => {
    global.fetch = jest.fn().mockResolvedValue(fakeResponse(204)) as jest.Mock;
    await expect(
      api('/servers/x', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });
});
