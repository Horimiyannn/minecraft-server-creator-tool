import {
  parseVanilla,
  parsePaper,
  parsePaperBuilds,
  parseForge,
  parseForgeBuilds,
  parseNeoforge,
  parseNeoforgeBuilds,
} from './fetchers';

describe('parseVanilla', () => {
  it('keeps only release versions, newest first', () => {
    const json = {
      latest: { release: '1.20.1' },
      versions: [
        { id: '1.20.1', type: 'release' },
        { id: '23w31a', type: 'snapshot' },
        { id: '1.20', type: 'release' },
      ],
    };
    expect(parseVanilla(json)).toEqual(['1.20.1', '1.20']);
  });
});

describe('parsePaper', () => {
  // Fill v3 groups versions by minor family, newest-first within and across
  // families (api.papermc.io/v2 is gone — it returns 410).
  const v3 = {
    project: { id: 'paper', name: 'Paper' },
    versions: {
      '26.2': ['26.2', '26.2-rc-2'],
      '26.1': ['26.1.2', '26.1.1'],
      '1.21': ['1.21.11', '1.21.11-pre5', '1.21.10'],
    },
  };

  it('flattens the grouped families in API order', () => {
    expect(parsePaper(v3)).toEqual([
      '26.2',
      '26.1.2',
      '26.1.1',
      '1.21.11',
      '1.21.10',
    ]);
  });

  it('drops release candidates and pre-releases', () => {
    expect(parsePaper(v3)).not.toContain('26.2-rc-2');
    expect(parsePaper(v3)).not.toContain('1.21.11-pre5');
  });
});

describe('parsePaperBuilds', () => {
  it('keeps stable build numbers in API (newest-first) order', () => {
    const json = [
      { id: 60, channel: 'STABLE' },
      { id: 59, channel: 'EXPERIMENTAL' },
      { id: 58, channel: 'STABLE' },
    ];
    expect(parsePaperBuilds(json)).toEqual(['60', '58']);
  });
});

describe('parseForge', () => {
  it('extracts unique MC versions from promo keys, newest first', () => {
    const json = {
      promos: {
        '1.19.2-latest': '43.2.0',
        '1.20.1-latest': '47.2.0',
        '1.20.1-recommended': '47.1.0',
        '26.2-latest': '65.1.3',
      },
    };
    expect(parseForge(json)).toEqual(['26.2', '1.20.1', '1.19.2']);
  });

  it('skips non-numeric MC keys', () => {
    const json = { promos: { '1.7.10_pre4-latest': '10.12.2.1149' } };
    expect(parseForge(json)).toEqual([]);
  });
});

describe('parseForgeBuilds', () => {
  // The real maven-metadata.xml is NOT sorted — MC lines are interleaved.
  const xml = `<metadata><versioning><versions>
    <version>1.20.1-47.4.23</version>
    <version>26.1.2-64.1.2</version>
    <version>1.20.1-47.2.0</version>
    <version>26.2-65.1.3</version>
    <version>1.20.1-47.10.0</version>
    <version>1.7.10_pre4-10.12.2.1149</version>
  </versions></versioning></metadata>`;

  it('returns only the builds for the requested MC version, newest first', () => {
    expect(parseForgeBuilds(xml, '1.20.1')).toEqual([
      '47.10.0',
      '47.4.23',
      '47.2.0',
    ]);
  });

  it('does not confuse a calendar MC version with a 1.x prefix', () => {
    expect(parseForgeBuilds(xml, '26.2')).toEqual(['65.1.3']);
  });

  it('returns nothing for an MC version with no builds', () => {
    expect(parseForgeBuilds(xml, '1.19.2')).toEqual([]);
  });
});

describe('parseNeoforge', () => {
  // Both versioning schemes coexist in the live metadata file.
  const xml = `<metadata><versioning><versions>
    <version>20.4.80-beta</version>
    <version>20.4.70</version>
    <version>20.2.88</version>
    <version>21.0.167</version>
    <version>26.1.2.108</version>
    <version>26.2.0.85</version>
    <version>26.1.0.0-alpha.10+snapshot-6</version>
    <version>21.0w14craftmine.1-beta</version>
  </versions></versioning></metadata>`;

  it('maps legacy 3-segment artifact versions to their MC version', () => {
    expect(parseNeoforge(xml)).toEqual(
      expect.arrayContaining(['1.20.4', '1.20.2']),
    );
  });

  it('maps current 4-segment artifact versions to calendar MC versions', () => {
    expect(parseNeoforge(xml)).toEqual(
      expect.arrayContaining(['26.1.2', '26.2']),
    );
  });

  it('trims the trailing .0 that MC release ids never carry', () => {
    // 21.0.167 targets MC 1.21 (not "1.21.0"); 26.2.0.85 targets 26.2.
    expect(parseNeoforge(xml)).toContain('1.21');
    expect(parseNeoforge(xml)).toContain('26.2');
    expect(parseNeoforge(xml)).not.toContain('1.21.0');
    expect(parseNeoforge(xml)).not.toContain('26.2.0');
  });

  it('skips the craftmine April Fools snapshots', () => {
    expect(parseNeoforge(xml).some((v) => v.includes('craftmine'))).toBe(false);
  });

  it('returns MC versions newest first, deduped', () => {
    expect(parseNeoforge(xml)).toEqual([
      '26.2',
      '26.1.2',
      '26.1',
      '1.21',
      '1.20.4',
      '1.20.2',
    ]);
  });
});

describe('parseNeoforgeBuilds', () => {
  const xml = `<metadata><versioning><versions>
    <version>21.1.73</version>
    <version>21.1.100</version>
    <version>21.1.74-beta</version>
    <version>26.1.2.108</version>
    <version>26.1.2.109-beta</version>
  </versions></versioning></metadata>`;

  it('returns stable builds for a legacy MC version, newest first', () => {
    expect(parseNeoforgeBuilds(xml, '1.21.1')).toEqual(['21.1.100', '21.1.73']);
  });

  it('returns stable builds for a calendar MC version', () => {
    expect(parseNeoforgeBuilds(xml, '26.1.2')).toEqual(['26.1.2.108']);
  });

  it('excludes beta builds', () => {
    expect(parseNeoforgeBuilds(xml, '1.21.1')).not.toContain('21.1.74-beta');
  });
});
