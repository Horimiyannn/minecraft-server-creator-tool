import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Loader } from '../servers/provisioning';
import { HttpFetcher } from './http-fetcher';
import {
  parseForge,
  parseForgeBuilds,
  parseNeoforge,
  parseNeoforgeBuilds,
  parsePaper,
  parsePaperBuilds,
  parseVanilla,
} from './fetchers';

export const HTTP_FETCHER = 'HTTP_FETCHER';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const VANILLA_MANIFEST_URL =
  'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
// Fill v3. The old api.papermc.io/v2 endpoints are sunset and answer 410.
const PAPER_PROJECT_URL = 'https://fill.papermc.io/v3/projects/paper';
const FORGE_PROMOTIONS_URL =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN_URL =
  'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const NEOFORGE_MAVEN_URL =
  'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

interface CacheEntry {
  at: number;
  versions: string[];
}

export interface VersionList {
  loader: Loader;
  versions: string[];
}

export interface BuildList {
  loader: Loader;
  mcVersion: string;
  builds: string[];
}

@Injectable()
export class VersionsService {
  private readonly cache = new Map<Loader, CacheEntry>();
  private readonly buildCache = new Map<string, CacheEntry>();

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

  /**
   * Loader builds for one MC version (e.g. which Forge 47.x to install).
   * Vanilla has no loader jar, so it always reports an empty list.
   */
  async listBuilds(loader: Loader, mcVersion: string): Promise<BuildList> {
    // Interpolated into an upstream URL below — reject anything that isn't a
    // plain numeric release id before it can reach the network.
    if (!/^\d+(\.\d+)*$/.test(mcVersion)) {
      throw new BadRequestException(`Invalid MC version "${mcVersion}"`);
    }
    const key = `${loader}:${mcVersion}`;
    const cached = this.buildCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { loader, mcVersion, builds: cached.versions };
    }
    const builds = await this.fetchBuilds(loader, mcVersion);
    this.buildCache.set(key, { at: Date.now(), versions: builds });
    return { loader, mcVersion, builds };
  }

  private async fetch(loader: Loader): Promise<string[]> {
    switch (loader) {
      case 'vanilla':
        return parseVanilla(
          await this.httpFetcher.getJson(VANILLA_MANIFEST_URL),
        );
      case 'paper':
        return parsePaper(await this.httpFetcher.getJson(PAPER_PROJECT_URL));
      case 'forge':
        return parseForge(await this.httpFetcher.getJson(FORGE_PROMOTIONS_URL));
      case 'neoforge':
        return parseNeoforge(
          await this.httpFetcher.getText(NEOFORGE_MAVEN_URL),
        );
      default:
        throw new BadRequestException(`Unknown loader "${loader}"`);
    }
  }

  private async fetchBuilds(
    loader: Loader,
    mcVersion: string,
  ): Promise<string[]> {
    switch (loader) {
      case 'vanilla':
        return [];
      case 'paper':
        return parsePaperBuilds(
          await this.httpFetcher.getJson(
            `${PAPER_PROJECT_URL}/versions/${mcVersion}/builds`,
          ),
        );
      case 'forge':
        return parseForgeBuilds(
          await this.httpFetcher.getText(FORGE_MAVEN_URL),
          mcVersion,
        );
      case 'neoforge':
        return parseNeoforgeBuilds(
          await this.httpFetcher.getText(NEOFORGE_MAVEN_URL),
          mcVersion,
        );
      default:
        throw new BadRequestException(`Unknown loader "${loader}"`);
    }
  }
}
