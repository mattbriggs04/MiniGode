import { randomBytes, randomUUID } from "node:crypto";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createId(prefix) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function createRoomCode(length = 6) {
  let value = "";

  while (value.length < length) {
    const bytes = randomBytes(length);

    for (const byte of bytes) {
      value += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
      if (value.length === length) {
        break;
      }
    }
  }

  return value;
}
