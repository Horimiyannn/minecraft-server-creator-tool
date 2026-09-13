import { BadRequestException } from '@nestjs/common';
import { VersionsService } from './versions.service';
import { HttpFetcher } from './http-fetcher';

function makeFetcher(): jest.Mocked<HttpFetcher> {
  return {
    getJson: jest.fn(),
    getText: jest.fn(),
  };
}

// PaperMC Fill v3 shape (v2 is sunset and answers 410).
const paperProject = {
  project: { id: 'paper', name: 'Paper' },
  versions: { '1.21': ['1.21.1', '1.21'] },
};

describe('VersionsService.list', () => {
  it('fetches + parses paper versions into the response shape', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue(paperProject);
    const svc = new VersionsService(http);
    await expect(svc.list('paper')).resolves.toEqual({
      loader: 'paper',
      versions: ['1.21.1', '1.21'],
    });
  });

  it('reads paper from the Fill v3 host, not the sunset v2 API', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue(paperProject);
    await new VersionsService(http).list('paper');
    expect(http.getJson).toHaveBeenCalledWith(
      'https://fill.papermc.io/v3/projects/paper',
    );
  });

  it('caches results so a second call does not refetch', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue(paperProject);
    const svc = new VersionsService(http);
    await svc.list('paper');
    await svc.list('paper');
    expect(http.getJson).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown loader', async () => {
    const svc = new VersionsService(makeFetcher());
    await expect(svc.list('bogus' as never)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('VersionsService.listBuilds', () => {
  it('returns paper builds for the requested MC version', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue([
      { id: 60, channel: 'STABLE' },
      { id: 59, channel: 'STABLE' },
    ]);
    const svc = new VersionsService(http);
    await expect(svc.listBuilds('paper', '1.21.8')).resolves.toEqual({
      loader: 'paper',
      mcVersion: '1.21.8',
      builds: ['60', '59'],
    });
    expect(http.getJson).toHaveBeenCalledWith(
      'https://fill.papermc.io/v3/projects/paper/versions/1.21.8/builds',
    );
  });

  it('returns forge builds parsed from maven metadata', async () => {
    const http = makeFetcher();
    http.getText.mockResolvedValue(
      '<versions><version>1.20.1-47.2.0</version><version>1.20.1-47.10.0</version></versions>',
    );
    const svc = new VersionsService(http);
    await expect(svc.listBuilds('forge', '1.20.1')).resolves.toEqual({
      loader: 'forge',
      mcVersion: '1.20.1',
      builds: ['47.10.0', '47.2.0'],
    });
  });

  it('returns neoforge builds parsed from maven metadata', async () => {
    const http = makeFetcher();
    http.getText.mockResolvedValue(
      '<versions><version>21.1.73</version><version>21.1.100</version></versions>',
    );
    const svc = new VersionsService(http);
    await expect(svc.listBuilds('neoforge', '1.21.1')).resolves.toEqual({
      loader: 'neoforge',
      mcVersion: '1.21.1',
      builds: ['21.1.100', '21.1.73'],
    });
  });

  it('reports no builds for vanilla, which has no loader jar to pick', async () => {
    const http = makeFetcher();
    const svc = new VersionsService(http);
    await expect(svc.listBuilds('vanilla', '1.21.8')).resolves.toEqual({
      loader: 'vanilla',
      mcVersion: '1.21.8',
      builds: [],
    });
    expect(http.getJson).not.toHaveBeenCalled();
    expect(http.getText).not.toHaveBeenCalled();
  });

  it('caches per loader+version', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue([{ id: 1, channel: 'STABLE' }]);
    const svc = new VersionsService(http);
    await svc.listBuilds('paper', '1.21.8');
    await svc.listBuilds('paper', '1.21.8');
    expect(http.getJson).toHaveBeenCalledTimes(1);
    await svc.listBuilds('paper', '1.21.7');
    expect(http.getJson).toHaveBeenCalledTimes(2);
  });

  // mcVersion is interpolated into an upstream URL, so it must be validated.
  it.each(['../../etc', '1.21.8/../..', 'latest', '1.21.8%2F..', ''])(
    'rejects a non-numeric MC version (%p)',
    async (bad) => {
      const http = makeFetcher();
      const svc = new VersionsService(http);
      await expect(svc.listBuilds('paper', bad)).rejects.toThrow(
        BadRequestException,
      );
      expect(http.getJson).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown loader', async () => {
    const svc = new VersionsService(makeFetcher());
    await expect(svc.listBuilds('bogus' as never, '1.21.8')).rejects.toThrow(
      BadRequestException,
    );
  });
});
