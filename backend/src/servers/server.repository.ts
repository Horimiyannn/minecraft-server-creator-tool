import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServerError, ServerErrorCode } from './server-errors';

export interface ServerRecord {
  id: string;
  name: string;
  loader: string;
  version: string;
  loaderVersion: string | null;
  ramMb: number;
  port: number;
  rconPassword: string;
  containerId: string | null;
  status: string;
  createdAt: Date;
}

export interface CreateServerData {
  name: string;
  loader: string;
  version: string;
  loaderVersion?: string | null;
  ramMb: number;
  port: number;
  rconPassword: string;
}

// Which unique column tripped, mapped to the code the client branches on.
const UNIQUE_CONFLICT: Record<string, ServerErrorCode> = {
  name: 'NAME_TAKEN',
  port: 'PORT_TAKEN',
};

@Injectable()
export class ServerRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(data: CreateServerData): Promise<ServerRecord> {
    try {
      return await this.prismaService.server.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // SQLite reports meta.target as an array of column names (verified
        // against Prisma 6.19); guard the shape rather than trusting it.
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? (target as string[]) : [];
        const field = fields.find((f) => f in UNIQUE_CONFLICT);
        throw new ServerError(
          field ? UNIQUE_CONFLICT[field] : 'UNKNOWN',
          `A server with that ${field ?? 'name or port'} already exists`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  findById(id: string): Promise<ServerRecord | null> {
    return this.prismaService.server.findUnique({ where: { id } });
  }

  list(): Promise<ServerRecord[]> {
    return this.prismaService.server.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  setContainer(
    id: string,
    containerId: string,
    status: string,
  ): Promise<ServerRecord> {
    return this.updateOrNotFound(id, { containerId, status });
  }

  setStatus(id: string, status: string): Promise<ServerRecord> {
    return this.updateOrNotFound(id, { status });
  }

  private async updateOrNotFound(
    id: string,
    data: Prisma.ServerUpdateInput,
  ): Promise<ServerRecord> {
    try {
      return await this.prismaService.server.update({ where: { id }, data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Server "${id}" not found`);
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prismaService.server.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Server "${id}" not found`);
      }
      throw error;
    }
  }
}
