import { BadRequestException } from '@nestjs/common';
import { VersionsService } from './versions.service';
import { HttpFetcher } from './http-fetcher';

function makeFetcher(): jest.Mocked<HttpFetcher> {
  return {
    getJson: jest.fn(),
    getText: jest.fn(),
  };
}

describe('VersionsService', () => {
  it('fetches + parses paper versions into the response shape', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue({ versions: ['1.20', '1.20.1'] });
    const svc = new VersionsService(http);
    await expect(svc.list('paper')).resolves.toEqual({
      loader: 'paper',
      versions: ['1.20.1', '1.20'],
    });
  });

  it('caches results so a second call does not refetch', async () => {
    const http = makeFetcher();
    http.getJson.mockResolvedValue({ versions: ['1.20.1'] });
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
