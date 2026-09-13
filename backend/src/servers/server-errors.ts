import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable, client-facing failure codes. The frontend maps these to copy, so
 * treat them as API surface: add codes, don't rename them.
 */
export type ServerErrorCode =
  | 'NAME_TAKEN'
  | 'PORT_TAKEN'
  | 'PORT_IN_USE'
  | 'IMAGE_PULL_FAILED'
  | 'DOCKER_UNAVAILABLE'
  | 'UNKNOWN';

interface ServerErrorBody {
  code: ServerErrorCode;
  message: string;
  statusCode: number;
}

export class ServerError extends HttpException {
  constructor(
    readonly code: ServerErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super(
      { code, message, statusCode: status } satisfies ServerErrorBody,
      status,
    );
  }
}

export interface CreateErrorContext {
  name: string;
  port: number;
}

// Docker surfaces these as opaque 500s with the daemon's message inline;
// matching on the message is the only signal available.
const PORT_CONFLICT =
  /port is already allocated|address already in use|failed programming external connectivity/i;
const DAEMON_DOWN = /connect (ENOENT|ECONNREFUSED|EACCES)|docker\.sock/i;
const PULL_FAILED =
  /manifest unknown|pull access denied|repository does not exist|manifest for .* not found/i;

/**
 * Turn a create-server failure into a coded HTTP error. Without this the
 * dockerode message reached the browser as a raw JSON blob.
 */
export function translateCreateError(
  error: unknown,
  context: CreateErrorContext,
): HttpException {
  // Repository conflicts and anything else already coded keep their own body.
  if (error instanceof HttpException) return error;

  const message = error instanceof Error ? error.message : String(error);

  if (PORT_CONFLICT.test(message)) {
    return new ServerError(
      'PORT_IN_USE',
      `Port ${context.port} is already in use on this host`,
      HttpStatus.CONFLICT,
    );
  }
  if (DAEMON_DOWN.test(message)) {
    return new ServerError(
      'DOCKER_UNAVAILABLE',
      'Cannot reach the Docker daemon',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  if (PULL_FAILED.test(message)) {
    return new ServerError(
      'IMAGE_PULL_FAILED',
      'Could not pull the Minecraft server image',
      HttpStatus.BAD_GATEWAY,
    );
  }
  return new ServerError('UNKNOWN', message, HttpStatus.INTERNAL_SERVER_ERROR);
}
