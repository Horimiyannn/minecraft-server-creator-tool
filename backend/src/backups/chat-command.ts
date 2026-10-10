export interface ChatCommand {
  player: string;
  command: string;
  arg?: string;
}

/**
 * Chat lines across loaders and versions:
 *   [10:31:02] [Server thread/INFO]: <Steve> !backup
 *   [10:31:02] [Async Chat Thread - #0/INFO]: [Not Secure] <Alex> !backup
 *   [10:31:02] [Server thread/INFO] [minecraft/MinecraftServer]: <Steve> !backup
 * The player name is taken from the log's own `<name>` marker, so nothing a
 * player types in the message body can impersonate someone else.
 */
const CHAT_LINE =
  /\[[^\]]*(?:Server thread|Async Chat Thread[^\]]*)\/INFO\](?:\s*\[[^\]]*\])?:\s*(?:\[Not Secure\]\s*)?<([^>]{1,32})>\s*(.*)$/;

const COMMAND = /^!([a-z]+)(?:\s+(.*))?$/i;

export function parseChatCommand(line: string): ChatCommand | null {
  const chat = CHAT_LINE.exec(line);
  if (!chat) return null;
  const [, player, message] = chat;
  const command = COMMAND.exec(message.trim());
  if (!command) return null;
  const arg = command[2]?.trim();
  return {
    player,
    command: command[1].toLowerCase(),
    arg: arg ? arg : undefined,
  };
}

/** `list` output, identical across vanilla, Paper, Forge and NeoForge. */
const PLAYER_COUNT = /There are (\d+)(?:\/\d+| of a max of \d+ players)/;

export function parsePlayerCount(listOutput: string): number | null {
  const match = PLAYER_COUNT.exec(listOutput);
  return match ? Number(match[1]) : null;
}

export function isJoinLine(line: string): boolean {
  return / joined the game\s*$/.test(line);
}
