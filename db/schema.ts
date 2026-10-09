import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
export const state = sqliteTable("state", { id: integer("id").primaryKey(), data: text("data").notNull(), version: integer("version").notNull() });
export const sessions = sqliteTable("sessions", { token: text("token").primaryKey(), role: text("role").notNull(), student: text("student").notNull(), csrf: text("csrf").notNull(), expires: real("expires").notNull() }, t => [index("idx_sessions_student").on(t.student), index("idx_sessions_expiry").on(t.expires)]);
export const invitations = sqliteTable("invitations", { student: text("student").primaryKey(), digest: text("digest").notNull().unique() });
export const history = sqliteTable("history", { id: text("id").primaryKey(), before: text("before").notNull() });
export const attempts = sqliteTable("login_attempts", { ip: text("ip").primaryKey(), count: integer("count").notNull(), expires: real("expires").notNull() });
