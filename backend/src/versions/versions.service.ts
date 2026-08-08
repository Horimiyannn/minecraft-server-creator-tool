import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Loader } from '../servers/provisioning';
import { HttpFetcher } from './http-fetcher';
import {
  parseForge,
  parseNeoforge,
  parsePaper,
  parseVanilla,
} from './fetchers';

export const HTTP_FETCHER = 'HTTP_FETCHER';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  at: number;
  versions: string[];
}

export interface VersionList {
  loader: Loader;
  versions: string[];
}

@Injectable()
export class VersionsService {
  private readonly cache = new Map<Loader, CacheEntry>();

  constructor(
    @Inject(HTTP_FETCHER) private readonly httpFetcher: HttpFetcher,
  ) {}

  async list(loader: Loader): Promise<VersionList> {
    const cached = this.cache.get(loader);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { loader, versions: cached.versions };
    }
    const versions = await this.fetch(loader);
    this.cache.set(loader, { at: Date.now(), versions });
    return { loader, versions };
  }

  private async fetch(loader: Loader): Promise<string[]> {
    switch (loader) {
      case 'vanilla':
        return parseVanilla(
          await this.httpFetcher.getJson(
            'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
          ),
        );
      case 'paper':
        return parsePaper(
          await this.httpFetcher.getJson(
            'https://api.papermc.io/v2/projects/paper',
          ),
        );
      case 'forge':
        return parseForge(
          await this.httpFetcher.getJson(
            'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
          ),
        );
      case 'neoforge':
        return parseNeoforge(
          await this.httpFetcher.getText(
            'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
          ),
        );
      default:
        throw new BadRequestException(`Unknown loader "${loader}"`);
    }
  }
}
