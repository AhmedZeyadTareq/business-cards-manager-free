import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt hashes, stored as scrypt$N$r$p$salt$hash (base64url).

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, { N: n, r, p, maxmem: 256 * n * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const cost = [Number(n), Number(r), Number(p)];
  if (cost.some((value) => !Number.isInteger(value) || value <= 0) || cost[0] > 2 ** 20) {
    return false;
  }
  try {
    const key = await derive(
      password,
      Buffer.from(salt, "base64url"),
      cost[0],
      cost[1],
      cost[2],
      expected.length,
    );
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/** For an unknown username: do the same work, so the answer takes the same time. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummy ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummy);
  return false;
}
