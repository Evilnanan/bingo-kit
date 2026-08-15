/**
 * Local cache of the identity code for the most recently joined room, so a
 * player can re-join that room (or recover from a reload / socket reconnect)
 * without re-entering the code.
 *
 * Only ONE room is cached at a time: joining a different room overwrites the
 * previous entry, so storage never accumulates. Legacy per-room keys from
 * older versions are cleaned up once on first load.
 *
 * The server remains the source of truth: this cache is only a convenience
 * and is overwritten whenever the server reports the authoritative code.
 */

const STORAGE_KEY = "bingo-kit:player-code";
// Older versions stored one key per room (`bingo-kit:player-code:<roomName>`),
// which accumulated forever. The single-slot format below supersedes them;
// drop every legacy key once on load so old junk doesn't linger.
const LEGACY_KEY_PREFIX = `${STORAGE_KEY}:`;

try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LEGACY_KEY_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
} catch {
  /* noop */
}

interface PlayerCodeSlot {
  room: string;
  codes: Record<string, string>;
}

function readSlot(): PlayerCodeSlot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as PlayerCodeSlot).room === "string" &&
      (parsed as PlayerCodeSlot).codes &&
      typeof (parsed as PlayerCodeSlot).codes === "object"
    ) {
      return parsed as PlayerCodeSlot;
    }
  } catch {
    /* noop */
  }
  return null;
}

function writeSlot(slot: PlayerCodeSlot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slot));
  } catch {
    /* noop */
  }
}

/** Read the locally cached identity code for a room + player name. */
export function getPlayerCode(roomName: string, name: string): string | null {
  const slot = readSlot();
  if (!slot || slot.room !== roomName) return null;
  return slot.codes[name] ?? null;
}

/** Store the identity code for a room + player name (replaces the previous room). */
export function savePlayerCode(
  roomName: string,
  name: string,
  code: string,
): void {
  if (!name || !code) return;
  const slot = readSlot();
  const codes = slot && slot.room === roomName ? slot.codes : {};
  codes[name] = code;
  writeSlot({ room: roomName, codes });
}

/** Move a cached code to a new player name after a rename. */
export function renamePlayerCode(
  roomName: string,
  oldName: string,
  newName: string,
): void {
  if (oldName === newName) return;
  const slot = readSlot();
  if (!slot || slot.room !== roomName) return;
  if (slot.codes[oldName] === undefined) return;
  slot.codes[newName] = slot.codes[oldName]!;
  delete slot.codes[oldName];
  writeSlot(slot);
}

/** Remove the cached code for a room + player name. */
export function removePlayerCode(roomName: string, name: string): void {
  const slot = readSlot();
  if (!slot || slot.room !== roomName) return;
  if (slot.codes[name] === undefined) return;
  delete slot.codes[name];
  writeSlot(slot);
}
