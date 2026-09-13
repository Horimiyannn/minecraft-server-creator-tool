import { API_URL } from '@/constants';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Stable backend failure code (see lib/errors.ts), when one was sent. */
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  code?: unknown;
  message?: unknown;
}

/**
 * Pull a code and a readable message out of an error response. Bodies come in
 * three shapes: our coded `{code, message}`, Nest's validation
 * `{message: string[]}`, and non-JSON (a proxy's HTML, say).
 */
function parseError(status: number, body: string): ApiError {
  let parsed: ErrorBody | undefined;
  try {
    parsed = JSON.parse(body) as ErrorBody;
  } catch {
    return new ApiError(status, body);
  }
  const { code, message } = parsed ?? {};
  const text = Array.isArray(message)
    ? message.join(', ')
    : typeof message === 'string'
      ? message
      : body;
  return new ApiError(
    status,
    text,
    typeof code === 'string' ? code : undefined,
  );
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw parseError(res.status, body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
