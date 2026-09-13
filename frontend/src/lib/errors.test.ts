import { ApiError } from './api-client';
import { errorText } from './errors';

describe('errorText', () => {
  it('maps a known code to friendly copy, ignoring the raw server text', () => {
    const error = new ApiError(
      409,
      'Bind for 0.0.0.0:25565 failed: port is already allocated',
      'PORT_IN_USE',
    );
    expect(errorText(error)).toBe(
      'That port is already in use on this machine. Try a different port.',
    );
  });

  it('distinguishes a panel-side port clash from a host-side one', () => {
    expect(errorText(new ApiError(409, '', 'PORT_TAKEN'))).not.toBe(
      errorText(new ApiError(409, '', 'PORT_IN_USE')),
    );
  });

  it('keeps the server message for an unmapped code', () => {
    // UNKNOWN is deliberately unmapped: the server text is more useful.
    expect(
      errorText(new ApiError(500, 'install-forge failed', 'UNKNOWN')),
    ).toBe('install-forge failed');
  });

  it('uses the server message when no code was sent', () => {
    expect(errorText(new ApiError(400, 'version has an invalid format'))).toBe(
      'version has an invalid format',
    );
  });

  it('handles a plain Error and a non-Error throw', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('nope')).toBe('Something went wrong. Please try again.');
    expect(errorText(new ApiError(500, ''))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
