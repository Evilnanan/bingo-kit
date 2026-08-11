/**
 * Local cache of identity codes so a player can re-join the same room (or
 * recover from a reload / socket reconnect) without re-entering the code.
 *
 * The server remains the source of truth: this cache is only a convenience
 * and is overwritten whenever the server reports the authoritative code.
 */

const KEY_PREFIX = "bingo-kit:player-code";

function keyFor(roomName: string): string {
  return `${KEY_PREFIX}:${roomName}`;
}

function readRoomCodes(roomName: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(keyFor(roomName));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    /* noop */
  }
  return {};
}

function writeRoomCodes(roomName: string, codes: Record<string, string>): void {
  try {
    localStorage.setItem(keyFor(roomName), JSON.stringify(codes));
  } catch {
    /* noop */
  }
}

/** Read the locally cached identity code for a room + player name. */
export function getPlayerCode(roomName: string, name: string): string | null {
  return readRoomCodes(roomName)[name] ?? null;
}

/** Store the identity code for a room + player name. */
export function savePlayerCode(
  roomName: string,
  name: string,
  code: string,
): void {
  if (!name || !code) return;
  const codes = readRoomCodes(roomName);
  codes[name] = code;
  writeRoomCodes(roomName, codes);
}

/** Move a cached code to a new player name after a rename. */
export function renamePlayerCode(
  roomName: string,
  oldName: string,
  newName: string,
): void {
  if (oldName === newName) return;
  const codes = readRoomCodes(roomName);
  if (codes[oldName] === undefined) return;
  codes[newName] = codes[oldName]!;
  delete codes[oldName];
  writeRoomCodes(roomName, codes);
}

/** Remove the cached code for a room + player name. */
export function removePlayerCode(roomName: string, name: string): void {
  const codes = readRoomCodes(roomName);
  if (codes[name] === undefined) return;
  delete codes[name];
  writeRoomCodes(roomName, codes);
}
