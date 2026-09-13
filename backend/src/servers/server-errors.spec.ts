import { ConflictException, HttpException } from '@nestjs/common';
import { ServerError, translateCreateError } from './server-errors';

const context = { name: 'survival', port: 25565 };

function bodyOf(error: HttpException): unknown {
  return error.getResponse();
}

describe('translateCreateError', () => {
  it('maps a docker port-allocation failure to PORT_IN_USE / 409', () => {
    const error = new Error(
      'driver failed programming external connectivity on endpoint mc-server-x: Bind for 0.0.0.0:25565 failed: port is already allocated',
    );
    const translated = translateCreateError(error, context);
    expect(translated.getStatus()).toBe(409);
    expect(bodyOf(translated)).toMatchObject({ code: 'PORT_IN_USE' });
    // The friendly message names the port the user actually typed.
    expect((bodyOf(translated) as { message: string }).message).toContain(
      '25565',
    );
  });

  it('also recognises the "address already in use" phrasing', () => {
    const translated = translateCreateError(
      new Error('listen tcp 0.0.0.0:25565: bind: address already in use'),
      context,
    );
    expect(bodyOf(translated)).toMatchObject({ code: 'PORT_IN_USE' });
  });

  it('maps an unreachable daemon to DOCKER_UNAVAILABLE / 503', () => {
    for (const message of [
      'connect ENOENT /var/run/docker.sock',
      'connect ECONNREFUSED /var/run/docker.sock',
      'connect EACCES /var/run/docker.sock',
    ]) {
      const translated = translateCreateError(new Error(message), context);
      expect(translated.getStatus()).toBe(503);
      expect(bodyOf(translated)).toMatchObject({
        code: 'DOCKER_UNAVAILABLE',
      });
    }
  });

  it('maps a failed image pull to IMAGE_PULL_FAILED / 502', () => {
    for (const message of [
      'manifest unknown: manifest unknown',
      'pull access denied for itzg/minecraft-server',
    ]) {
      const translated = translateCreateError(new Error(message), context);
      expect(translated.getStatus()).toBe(502);
      expect(bodyOf(translated)).toMatchObject({ code: 'IMAGE_PULL_FAILED' });
    }
  });

  it('passes an already-coded ServerError straight through', () => {
    const original = new ServerError('NAME_TAKEN', 'nope', 409);
    expect(translateCreateError(original, context)).toBe(original);
  });

  it('leaves a plain HttpException alone rather than flattening it to UNKNOWN', () => {
    const original = new ConflictException('something specific');
    expect(translateCreateError(original, context)).toBe(original);
  });

  it('falls back to UNKNOWN / 500 and keeps the original text', () => {
    const translated = translateCreateError(
      new Error('something went sideways'),
      context,
    );
    expect(translated.getStatus()).toBe(500);
    expect(bodyOf(translated)).toMatchObject({
      code: 'UNKNOWN',
      message: 'something went sideways',
    });
  });

  it('handles a non-Error throw without crashing', () => {
    const translated = translateCreateError('just a string', context);
    expect(translated.getStatus()).toBe(500);
    expect(bodyOf(translated)).toMatchObject({ code: 'UNKNOWN' });
  });
});

describe('ServerError', () => {
  it('serialises a body the client can branch on', () => {
    const error = new ServerError('PORT_TAKEN', 'Port 25565 is taken', 409);
    expect(error.getResponse()).toEqual({
      code: 'PORT_TAKEN',
      message: 'Port 25565 is taken',
      statusCode: 409,
    });
  });
});
