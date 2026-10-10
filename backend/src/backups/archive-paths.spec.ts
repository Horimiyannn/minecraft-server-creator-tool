import {
  archiveName,
  FULL_EXCLUDES,
  levelName,
  worldDirs,
} from './archive-paths';

describe('levelName', () => {
  it('reads level-name from server.properties', () => {
    expect(levelName('#comment\nlevel-name=myworld\nmax-players=20\n')).toBe(
      'myworld',
    );
  });

  it('ignores a commented-out level-name and falls back to world', () => {
    expect(levelName('#level-name=nope\n')).toBe('world');
    expect(levelName('')).toBe('world');
  });

  it('trims trailing whitespace and carriage returns', () => {
    expect(levelName('level-name=myworld \r\n')).toBe('myworld');
  });
});

describe('worldDirs', () => {
  it('includes the nether and end dirs only when they exist', () => {
    expect(
      worldDirs('world', ['world', 'world_nether', 'mods', 'config']),
    ).toEqual(['world', 'world_nether']);
  });

  it('follows a renamed level', () => {
    expect(worldDirs('survival', ['survival', 'survival_the_end'])).toEqual([
      'survival',
      'survival_the_end',
    ]);
  });

  it('returns an empty list when the world has not generated yet', () => {
    expect(worldDirs('world', ['mods'])).toEqual([]);
  });
});

describe('FULL_EXCLUDES', () => {
  it('drops rebuildable junk but never mods, plugins or config', () => {
    expect(FULL_EXCLUDES).toEqual(
      expect.arrayContaining([
        './logs',
        './cache',
        './crash-reports',
        './libraries',
        './versions',
        './*.jar',
      ]),
    );
    expect(FULL_EXCLUDES).not.toEqual(
      expect.arrayContaining(['./mods', './plugins', './config']),
    );
  });
});

describe('archiveName', () => {
  it('encodes kind, timestamp and a sanitized label', () => {
    const at = new Date('2026-09-12T10:30:00.000Z');
    expect(archiveName('world', at, 'before raid')).toBe(
      'world-20260912-103000-before-raid.tar.zst',
    );
    expect(archiveName('full', at)).toBe('full-20260912-103000.tar.zst');
  });

  it('strips path separators out of a player-supplied label', () => {
    const at = new Date('2026-09-12T10:30:00.000Z');
    expect(archiveName('world', at, '../../etc/passwd')).toBe(
      'world-20260912-103000-etc-passwd.tar.zst',
    );
  });
});
