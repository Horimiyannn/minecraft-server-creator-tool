export interface HttpFetcher {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
}

// PaperMC's Fill API asks callers to identify themselves and rate-limits
// anonymous traffic more aggressively.
const USER_AGENT = 'mc-panel/1.0 (+self-hosted)';

export class FetchHttpFetcher implements HttpFetcher {
  async getJson(url: string): Promise<unknown> {
    return (await this.get(url)).json();
  }

  async getText(url: string): Promise<string> {
    return (await this.get(url)).text();
  }

  private async get(url: string): Promise<Response> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res;
  }
}
