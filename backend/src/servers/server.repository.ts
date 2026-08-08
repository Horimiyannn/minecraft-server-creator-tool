import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ServerRecord {
  id: string;
  name: string;
  loader: string;
  version: string;
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
  ramMb: number;
  port: number;
  rconPassword: string;
}

@Injectable()
export class ServerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateServerData): Promise<ServerRecord> {
    try {
      return await this.prisma.server.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = (error.meta?.target as string[] | undefined)?.join(', ');
        throw new ConflictException(
          `A server with that ${target ?? 'name or port'} already exists`,
        );
      }
      throw error;
    }
  }

  findById(id: string): Promise<ServerRecord | null> {
    return this.prisma.server.findUnique({ where: { id } });
  }

  list(): Promise<ServerRecord[]> {
    return this.prisma.server.findMany({ orderBy: { createdAt: 'asc' } });
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
      return await this.prisma.server.update({ where: { id }, data });
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
      await this.prisma.server.delete({ where: { id } });
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
