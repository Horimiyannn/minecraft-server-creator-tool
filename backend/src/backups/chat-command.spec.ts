import { isJoinLine, parseChatCommand, parsePlayerCount } from './chat-command';

describe('parseChatCommand', () => {
  it.each([
    [
      '[10:31:02] [Server thread/INFO]: <Steve> !backup',
      { player: 'Steve', command: 'backup', arg: undefined },
    ],
    [
      '[10:31:02] [Server thread/INFO]: <Steve> !backup before raid',
      { player: 'Steve', command: 'backup', arg: 'before raid' },
    ],
    [
      // Paper 1.19+ moves chat onto an async thread and marks it unsigned
      '[10:31:02] [Async Chat Thread - #0/INFO]: [Not Secure] <Alex> !backup',
      { player: 'Alex', command: 'backup', arg: undefined },
    ],
    [
      // Forge prefixes the log with the mod loader's marker
      '[10:31:02] [Server thread/INFO] [minecraft/MinecraftServer]: <Steve> !backup',
      { player: 'Steve', command: 'backup', arg: undefined },
    ],
  ])('parses %s', (line, expected) => {
    expect(parseChatCommand(line)).toEqual(expected);
  });

  it.each([
    ['[10:31:02] [Server thread/INFO]: <Steve> hello world'],
    ['[10:31:02] [Server thread/INFO]: Steve joined the game'],
    ['[10:31:02] [Server thread/INFO]: <Steve> tell me about !backup'],
    ['random noise'],
  ])('returns null for %s', (line) => {
    expect(parseChatCommand(line)).toBeNull();
  });

  it('does not let chat content forge a different player name', () => {
    const parsed = parseChatCommand(
      '[10:31:02] [Server thread/INFO]: <Mallory> !backup <Admin> !backup',
    );
    expect(parsed).toEqual({
      player: 'Mallory',
      command: 'backup',
      arg: '<Admin> !backup',
    });
  });
});

describe('parsePlayerCount', () => {
  it.each([
    ['There are 3 of a max of 20 players online: A, B, C', 3],
    ['There are 0 of a max of 20 players online:', 0],
    ['There are 2/20 players online:', 2],
  ])('reads %s', (output, expected) => {
    expect(parsePlayerCount(output)).toBe(expected);
  });

  it('returns null when the output is not a player list', () => {
    expect(parsePlayerCount('Unknown command')).toBeNull();
  });
});

describe('isJoinLine', () => {
  it('detects a join and ignores a leave', () => {
    expect(
      isJoinLine('[10:31:02] [Server thread/INFO]: Steve joined the game'),
    ).toBe(true);
    expect(
      isJoinLine('[10:31:02] [Server thread/INFO]: Steve left the game'),
    ).toBe(false);
  });
});
