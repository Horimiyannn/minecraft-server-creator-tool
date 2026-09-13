import { ApiError } from './api-client';

/**
 * Copy for the backend's stable error codes (see backend
 * `servers/server-errors.ts`). A code with no entry here — notably UNKNOWN —
 * falls through to the message the server sent, which carries more detail
 * than any generic line we could write.
 */
const ERROR_MESSAGES: Record<string, string> = {
  NAME_TAKEN: 'A server with that name already exists. Pick another name.',
  PORT_TAKEN: 'Another server in this panel already uses that port.',
  PORT_IN_USE:
    'That port is already in use on this machine. Try a different port.',
  IMAGE_PULL_FAILED:
    'Could not download the Minecraft server image. Check the host network and try again.',
  DOCKER_UNAVAILABLE:
    'Cannot reach Docker. Make sure the Docker daemon is running.',
};

const FALLBACK = 'Something went wrong. Please try again.';

/** Turn any thrown value into a line that is safe to show a user. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const mapped = error.code ? ERROR_MESSAGES[error.code] : undefined;
    // Truthiness, not nullishness: an empty body yields an empty message.
    return mapped || error.message || FALLBACK;
  }
  if (error instanceof Error && error.message) return error.message;
  return FALLBACK;
}
