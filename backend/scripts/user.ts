import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';

async function withUsers<T>(
  fn: (users: UsersService) => Promise<T>,
): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    await fn(app.get(UsersService));
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

const program = new Command();
program.name('user').description('Manage MC panel accounts');

program
  .command('create')
  .argument('<username>')
  .argument('<password>')
  .action(async (username: string, password: string) => {
    await withUsers(async (users) => {
      await users.createUser(username, password);
      console.log(`Created user "${username}".`);
    });
  });

program
  .command('reset')
  .argument('<username>')
  .argument('<newPassword>')
  .action(async (username: string, newPassword: string) => {
    await withUsers(async (users) => {
      await users.resetPassword(username, newPassword);
      console.log(`Reset password for "${username}".`);
    });
  });

program
  .command('delete')
  .argument('<username>')
  .action(async (username: string) => {
    await withUsers(async (users) => {
      await users.deleteUser(username);
      console.log(`Deleted user "${username}".`);
    });
  });

program
  .command('list')
  .action(async () => {
    await withUsers(async (users) => {
      const list = await users.listUsers();
      if (list.length === 0) {
        console.log('No users.');
        return;
      }
      for (const u of list) {
        console.log(`${u.username}\t${u.createdAt.toISOString()}`);
      }
    });
  });

void program.parseAsync();
