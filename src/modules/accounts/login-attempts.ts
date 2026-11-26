import { collections } from "@/modules/db/mongo";

// Failed sign-ins per username + network address. 5 wrong passwords lock that address
// out of that username for 15 minutes; the real person, elsewhere, can still sign in.

export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60_000;

const key = (username: string, address: string) => `${username}|${address}`;

/** `x-real-ip`, else the first `x-forwarded-for` entry, else "local". */
export function addressOf(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

export async function isLocked(username: string, address: string, now = new Date()) {
  const doc = await collections().loginAttempts.findOne({ _id: key(username, address) });
  return Boolean(doc && doc.count >= MAX_ATTEMPTS && doc.expiresAt > now);
}

export async function recordFailure(username: string, address: string, now = new Date()) {
  const until = new Date(now.getTime() + LOCK_MS);
  await collections().loginAttempts.updateOne(
    { _id: key(username, address) },
    [
      {
        $set: {
          username,
          // A count whose 15 minutes have passed starts again (the TTL delete can lag).
          count: { $cond: [{ $gt: ["$expiresAt", now] }, { $add: ["$count", 1] }, 1] },
          expiresAt: until,
        },
      },
    ],
    { upsert: true },
  );
}

/** A successful sign-in clears that address's count. */
export async function clearAttempts(username: string, address: string): Promise<void> {
  await collections().loginAttempts.deleteOne({ _id: key(username, address) });
}

/** An admin password reset clears every lock on the username. */
export async function clearLocks(username: string): Promise<void> {
  await collections().loginAttempts.deleteMany({ username });
}
