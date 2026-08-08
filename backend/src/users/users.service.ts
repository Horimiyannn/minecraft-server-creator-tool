import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRepository } from './user.repository';
import { hashPassword, verifyPassword } from '../auth/password.util';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UserRepository) {}

  async createUser(username: string, plainPassword: string): Promise<void> {
    const existing = await this.repo.findByUsername(username);
    if (existing) {
      throw new ConflictException(`User "${username}" already exists`);
    }
    await this.repo.create(username, await hashPassword(plainPassword));
  }

  async validateCredentials(
    username: string,
    plainPassword: string,
  ): Promise<{ id: number; username: string } | null> {
    const user = await this.repo.findByUsername(username);
    if (!user) return null;
    const ok = await verifyPassword(plainPassword, user.passwordHash);
    if (!ok) return null;
    return { id: user.id, username: user.username };
  }

  async resetPassword(username: string, newPassword: string): Promise<void> {
    const user = await this.repo.findByUsername(username);
    if (!user) throw new NotFoundException(`User "${username}" not found`);
    await this.repo.updatePasswordHash(
      username,
      await hashPassword(newPassword),
    );
  }

  async deleteUser(username: string): Promise<void> {
    const user = await this.repo.findByUsername(username);
    if (!user) throw new NotFoundException(`User "${username}" not found`);
    await this.repo.delete(username);
  }

  listUsers(): Promise<{ username: string; createdAt: Date }[]> {
    return this.repo.list();
  }
}
