import type { ObjectId } from "mongodb";
import { config } from "@/lib/config";
import { dayInZone } from "@/lib/dates";
import { collections } from "@/modules/db/mongo";
import { AppError } from "@/modules/shared/errors";

export const AI_LIMIT_MESSAGE =
  "You have used your AI allowance for today. Quick search and manual add still work.";

/**
 * The per-user daily AI limit: adds 1 to the person's count for today (app time zone)
 * and refuses once it is above AI_USER_DAILY_LIMIT. The use counts even if the AI fails.
 */
export async function spendAiUse(userId: ObjectId, now: Date = new Date()): Promise<void> {
  const limit = config().AI_USER_DAILY_LIMIT;
  if (limit === 0) return;
  const day = dayInZone(now, config().APP_TIME_ZONE);
  const doc = await collections().aiUsage.findOneAndUpdate(
    { _id: `${userId.toHexString()}|${day}` },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60_000) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (doc && doc.count > limit) throw new AppError("TOO_MANY_REQUESTS", AI_LIMIT_MESSAGE);
}
