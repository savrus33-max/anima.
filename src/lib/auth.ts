import { randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export async function getUser() {
  const token = (await cookies()).get("anima_session")?.value;
  if (!token) return null;
  const [entry] = await db.select({ user: users }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, digest(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return entry ? publicUser(entry.user) : null;
}
export function publicUser(user: typeof users.$inferSelect) {
  return { id: user.id, name: user.name, email: user.email, avatar: user.avatar, accent: user.accent, bio: user.bio, createdAt: user.createdAt };
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await db.insert(sessions).values({ token: digest(token), userId, expiresAt });
  (await cookies()).set("anima_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: expiresAt, path: "/" });
}
export type User = NonNullable<Awaited<ReturnType<typeof getUser>>>;
