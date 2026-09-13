import { resolveInRoot, PathError } from './path';

const ROOT = '/srv/mc/abc/data';

describe('resolveInRoot', () => {
  it.each([
    ['', ROOT],
    ['.', ROOT],
    ['mods', `${ROOT}/mods`],
    ['/mods', `${ROOT}/mods`], // leading slash is treated as root-relative
    ['mods/../config/a.toml', `${ROOT}/config/a.toml`],
    ['./world/level.dat', `${ROOT}/world/level.dat`],
  ])('resolves %p inside the root', (rel, expected) => {
    expect(resolveInRoot(ROOT, rel)).toBe(expected);
  });

  it.each([
    ['..'],
    ['../../etc/passwd'],
    ['mods/../../..'],
    ['mods/../../other/data'],
    ['\0etc'],
    ['mods/\0/x'],
  ])('rejects %p', (rel) => {
    expect(() => resolveInRoot(ROOT, rel)).toThrow(PathError);
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    expect(() => resolveInRoot('/srv/mc/abc/data', '../data-evil')).toThrow(
      PathError,
    );
  });
});
