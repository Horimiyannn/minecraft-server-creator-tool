export interface HttpFetcher {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
}

export class FetchHttpFetcher implements HttpFetcher {
  async getJson(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.json();
  }

  async getText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.text();
  }
}
