import { describe, expect, it } from "vitest";
import { permissionsFor, Password, Username } from "@/modules/accounts/account.schema";
import { hashPassword, verifyPassword } from "@/modules/accounts/password";
import { createSessionToken, readSessionToken, SESSION_SECONDS } from "@/modules/accounts/session";
import { addDays, dayInZone, endOfDay, formatDate, formatDateTime, startOfDay } from "@/lib/dates";

const USER = "0123456789abcdef01234567";

describe("session tokens", () => {
  it("round-trips a token", () => {
    const now = Date.UTC(2026, 10, 2);
    const token = createSessionToken(USER, 3, now);
    expect(token.split(".")).toHaveLength(4);
    expect(readSessionToken(token, now)).toEqual({
      userId: USER,
      sessionVersion: 3,
      expiresAt: now + SESSION_SECONDS * 1000,
    });
  });

  it("expires after 30 days", () => {
    const now = Date.UTC(2026, 10, 2);
    const token = createSessionToken(USER, 1, now);
    expect(readSessionToken(token, now + 29 * 86_400_000)).not.toBeNull();
    expect(readSessionToken(token, now + 31 * 86_400_000)).toBeNull();
  });

  it("refuses a changed or malformed token", () => {
    const token = createSessionToken(USER, 1);
    const [id, version, expiry, signature] = token.split(".");
    expect(readSessionToken(`${id}.2.${expiry}.${signature}`)).toBeNull();
    expect(readSessionToken(`${id}.${version}.${Number(expiry) + 1}.${signature}`)).toBeNull();
    expect(readSessionToken(`${"f".repeat(24)}.${version}.${expiry}.${signature}`)).toBeNull();
    expect(readSessionToken(`${id}.${version}.${expiry}.${signature.slice(1)}x`)).toBeNull();
    expect(readSessionToken(`${id}.${version}.${expiry}`)).toBeNull();
    expect(readSessionToken("")).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();
    expect(readSessionToken("garbage")).toBeNull();
  });
});

describe("passwords", () => {
  it("hashes with scrypt and verifies", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[\w-]{22}\$[\w-]{86}$/);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
    expect(await hashPassword("correct horse")).not.toBe(hash); // new salt each time
  });

  it("rejects a malformed stored hash", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plain-text")).toBe(false);
    expect(await verifyPassword("x", "scrypt$0$8$1$abc$def")).toBe(false);
  });

  it("validates usernames and passwords", () => {
    expect(Username.parse("  Ahmed.Ali_1 ")).toBe("ahmed.ali_1");
    expect(Username.safeParse("ab").success).toBe(false);
    expect(Username.safeParse("has space").success).toBe(false);
    expect(Username.safeParse("أحمد").success).toBe(false);
    expect(Password.safeParse("1234567").success).toBe(false);
    expect(Password.safeParse("12345678").success).toBe(true);
    expect(Password.safeParse("x".repeat(201)).success).toBe(false);
  });
});

describe("permissions", () => {
  it("follows the roles table", () => {
    expect(permissionsFor("viewer")).toEqual({
      add: false,
      edit: false,
      delete: false,
      export: false,
      admin: false,
    });
    expect(permissionsFor("editor")).toEqual({
      add: true,
      edit: true,
      delete: true,
      export: true,
      admin: false,
    });
    expect(permissionsFor("admin")).toEqual({
      add: true,
      edit: true,
      delete: true,
      export: true,
      admin: true,
    });
  });
});

describe("dates in the app time zone", () => {
  const zone = "Asia/Baghdad"; // UTC+3, no daylight saving

  it("finds the day and its boundaries", () => {
    expect(dayInZone(new Date("2026-11-01T21:30:00Z"), zone)).toBe("2026-11-02");
    expect(startOfDay("2026-11-02", zone).toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect(endOfDay("2026-11-02", zone).toISOString()).toBe("2026-11-02T21:00:00.000Z");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles a daylight-saving zone", () => {
    expect(startOfDay("2026-03-29", "Europe/Berlin").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(endOfDay("2026-03-29", "Europe/Berlin").toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("formats dates one way everywhere", () => {
    expect(formatDate("2026-11-02T11:05:00Z", zone)).toBe("2 Nov 2026");
    expect(formatDateTime("2026-11-02T11:05:00Z", zone)).toBe("2 Nov 2026, 14:05");
    expect(formatDateTime("2026-11-02T21:05:00Z", zone)).toBe("3 Nov 2026, 00:05");
  });
});
