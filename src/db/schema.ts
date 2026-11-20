import { pgTable, text, integer, timestamp, boolean, jsonb, primaryKey } from "drizzle-orm/pg-core";

export const users = pgTable("anima_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  verified: boolean("verified").notNull().default(false),
  avatar: text("avatar").notNull().default("moon"),
  accent: text("accent").notNull().default("lime"),
  bio: text("bio").notNull().default("Моя история только начинается ✨"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const verificationCodes = pgTable("anima_verification_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
});
export const sessions = pgTable("anima_sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
});
export const library = pgTable("anima_library", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  animeId: integer("anime_id").notNull(),
  anime: jsonb("anime").notNull(),
  status: text("status").notNull().default("planned"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.animeId] })]);
export const rooms = pgTable("anima_rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  hostId: text("host_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  anime: jsonb("anime").notNull(),
  isPrivate: boolean("is_private").notNull().default(false),
  playing: boolean("playing").notNull().default(false),
  position: integer("position").notNull().default(0),
  episode: integer("episode").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const roomMembers = pgTable("anima_room_members", {
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.roomId, t.userId] })]);
export const messages = pgTable("anima_messages", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
