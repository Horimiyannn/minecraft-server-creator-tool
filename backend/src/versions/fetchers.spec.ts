import {
  parseVanilla,
  parsePaper,
  parseForge,
  parseNeoforge,
} from './fetchers';

describe('version parsers', () => {
  it('parseVanilla keeps only release versions, newest first', () => {
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

  it('parsePaper returns versions newest first', () => {
    const json = { versions: ['1.20', '1.20.1'] };
    expect(parsePaper(json)).toEqual(['1.20.1', '1.20']);
  });

  it('parseForge extracts unique MC versions from promo keys', () => {
    const json = {
      promos: {
        '1.20.1-latest': '47.2.0',
        '1.20.1-recommended': '47.1.0',
        '1.19.2-latest': '43.2.0',
      },
    };
    expect(parseForge(json)).toEqual(['1.20.1', '1.19.2']);
  });

  it('parseNeoforge maps MAJOR.MINOR artifact versions to MC versions', () => {
    const xml = `<metadata><versioning><versions>
      <version>20.4.80-beta</version>
      <version>20.4.70</version>
      <version>20.2.88</version>
    </versions></versioning></metadata>`;
    expect(parseNeoforge(xml)).toEqual(['1.20.4', '1.20.2']);
  });
});
