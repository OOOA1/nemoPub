import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, decimal } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  telegramId: varchar("telegram_id").notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  isSubscribed: boolean("is_subscribed").default(false),
  weeklyInspectorRequests: integer("weekly_inspector_requests").default(0),
  weeklyDesignerRequests: integer("weekly_designer_requests").default(0),
  totalPurchasedRequests: integer("total_purchased_requests").default(0),
  referralCode: varchar("referral_code").unique(),
  referredBy: varchar("referred_by"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  lastActivity: timestamp("last_activity").defaultNow(),
});

export const subscriptionChecks = pgTable("subscription_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  isSubscribed: boolean("is_subscribed").notNull(),
  checkedAt: timestamp("checked_at").defaultNow(),
});

export const aiRequests = pgTable("ai_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  agentType: varchar("agent_type").notNull(), // 'inspector' | 'designer'
  imageUrl: text("image_url"),
  prompt: text("prompt"),
  response: text("response"),
  processingTime: integer("processing_time"), // in seconds
  status: varchar("status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  telegramPaymentChargeId: varchar("telegram_payment_charge_id"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").notNull().default("RUB"),
  requestsAdded: integer("requests_added").notNull(),
  status: varchar("status").notNull().default("pending"), // 'pending' | 'completed' | 'failed' | 'refunded'
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const referrals = pgTable("referrals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referrerId: varchar("referrer_id").notNull().references(() => users.id),
  referredId: varchar("referred_id").notNull().references(() => users.id),
  bonusGranted: boolean("bonus_granted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const broadcasts = pgTable("broadcasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  targetAudience: varchar("target_audience").notNull(), // 'all' | 'subscribers' | 'active' | 'paying'
  sentCount: integer("sent_count").default(0),
  deliveredCount: integer("delivered_count").default(0),
  errorCount: integer("error_count").default(0),
  status: varchar("status").notNull().default("draft"), // 'draft' | 'sending' | 'completed' | 'failed'
  createdAt: timestamp("created_at").defaultNow(),
  sentAt: timestamp("sent_at"),
});

export const broadcastDeliveries = pgTable("broadcast_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  broadcastId: varchar("broadcast_id").notNull().references(() => broadcasts.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  status: varchar("status").notNull(), // 'sent' | 'delivered' | 'failed'
  errorMessage: text("error_message"),
  deliveredAt: timestamp("delivered_at").defaultNow(),
});

export const botSettings = pgTable("bot_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const leadRequests = pgTable("lead_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  interest: varchar("interest").notNull(), // 'repair' | 'supervision' | 'design'
  source: varchar("source"), // 'inspector' | 'designer' | 'main_menu'
  status: varchar("status").notNull().default("new"), // 'new' | 'contacted' | 'closed'
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  subscriptionChecks: many(subscriptionChecks),
  aiRequests: many(aiRequests),
  payments: many(payments),
  referralsGiven: many(referrals, { relationName: "referrer" }),
  referralsReceived: many(referrals, { relationName: "referred" }),
  broadcastDeliveries: many(broadcastDeliveries),
  leadRequests: many(leadRequests),
}));

export const subscriptionChecksRelations = relations(subscriptionChecks, ({ one }) => ({
  user: one(users, {
    fields: [subscriptionChecks.userId],
    references: [users.id],
  }),
}));

export const aiRequestsRelations = relations(aiRequests, ({ one }) => ({
  user: one(users, {
    fields: [aiRequests.userId],
    references: [users.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, {
    fields: [payments.userId],
    references: [users.id],
  }),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  referrer: one(users, {
    fields: [referrals.referrerId],
    references: [users.id],
    relationName: "referrer",
  }),
  referred: one(users, {
    fields: [referrals.referredId],
    references: [users.id],
    relationName: "referred",
  }),
}));

export const broadcastsRelations = relations(broadcasts, ({ many }) => ({
  deliveries: many(broadcastDeliveries),
}));

export const broadcastDeliveriesRelations = relations(broadcastDeliveries, ({ one }) => ({
  broadcast: one(broadcasts, {
    fields: [broadcastDeliveries.broadcastId],
    references: [broadcasts.id],
  }),
  user: one(users, {
    fields: [broadcastDeliveries.userId],
    references: [users.id],
  }),
}));

export const leadRequestsRelations = relations(leadRequests, ({ one }) => ({
  user: one(users, {
    fields: [leadRequests.userId],
    references: [users.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertAiRequestSchema = createInsertSchema(aiRequests).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertBroadcastSchema = createInsertSchema(broadcasts).omit({
  id: true,
  createdAt: true,
  sentAt: true,
});

export const insertLeadRequestSchema = createInsertSchema(leadRequests).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type AiRequest = typeof aiRequests.$inferSelect;
export type InsertAiRequest = z.infer<typeof insertAiRequestSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Broadcast = typeof broadcasts.$inferSelect;
export type InsertBroadcast = z.infer<typeof insertBroadcastSchema>;
export type LeadRequest = typeof leadRequests.$inferSelect;
export type InsertLeadRequest = z.infer<typeof insertLeadRequestSchema>;

import {pgEnum} from "drizzle-orm/pg-core";

/** --- Новые enum-ы (значения на англ., отображение — в UI/боте русское) --- */
export const defectCategoryEnum = pgEnum("defect_category", [
  "architecture", "structural", "electrical", "plumbing", "finishing", "landscaping",
]);

export const defectSeverityEnum = pgEnum("defect_severity", [
  "critical", "medium", "low",
]);

export const defectStatusEnum = pgEnum("defect_status", [
  "discovered", "on_control", "fixed", "awaiting_review",
]);

export const defectPhotoTypeEnum = pgEnum("defect_photo_type", [
  "initial", "before", "after", "generic",
]);

/** --- Таблица defects --- */
export const defects = pgTable("defects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  humanId: varchar("human_id")
    .notNull()
    .unique()
    .default(sql`'D-' || lpad(nextval('defects_human_id_seq')::text, 6, '0')`),
  object: varchar("object").notNull(),
  floor: varchar("floor"),
  category: defectCategoryEnum("category").notNull(),
  severity: defectSeverityEnum("severity").notNull(),
  description: text("description"),
  status: defectStatusEnum("status").notNull().default("discovered"),
  createdByUserId: varchar("created_by_user_id").notNull(),
  assigneeUserId: varchar("assignee_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  assignedTo: varchar("assigned_to"),            // nullable
  dueDate: timestamp("due_date", { withTimezone: true }), // nullable
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
});

export const defectsRelations = relations(defects, ({ many }) => ({
  photos: many(defectPhotos),
  actions: many(defectActions),
}));

/** --- Таблица defect_photos --- */
export const defectPhotos = pgTable("defect_photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  defectId: varchar("defect_id").notNull(),
  type: defectPhotoTypeEnum("type").notNull(),
  telegramFileId: varchar("telegram_file_id").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const defectPhotosRelations = relations(defectPhotos, ({ one }) => ({
  defect: one(defects, {
    fields: [defectPhotos.defectId],
    references: [defects.id],
  }),
}));

/** --- Таблица defect_actions --- */
export const defectActions = pgTable("defect_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  defectId: varchar("defect_id").notNull(),
  actorUserId: varchar("actor_user_id").notNull(),
  action: varchar("action").notNull(), // create|update|status_change|assign|add_photo|comment
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const defectActionsRelations = relations(defectActions, ({ one }) => ({
  defect: one(defects, {
    fields: [defectActions.defectId],
    references: [defects.id],
  }),
}));

/** --- Zod-схемы для валидации (в контроллерах/боте удобно) --- */
export const insertDefectSchema = createInsertSchema(defects, {
  humanId: z.string().optional(), // сгенерится базой
  object: z.string().min(1),
  floor: z.string().optional(),
  category: z.enum(["architecture","structural","electrical","plumbing","finishing","landscaping"]),
  severity: z.enum(["critical","medium","low"]),
  description: z.string().optional(),
  status: z.enum(["discovered","on_control","fixed","awaiting_review"]).optional(),
  assigneeUserId: z.string().optional(),
}).omit({ id: true, createdAt: true, updatedAt: true, closedAt: true, createdByUserId: true });

export type InsertDefect = z.infer<typeof insertDefectSchema>;
export type Defect = typeof defects.$inferSelect;

export const insertDefectPhotoSchema = createInsertSchema(defectPhotos).omit({ id: true, createdAt: true });
export type InsertDefectPhoto = z.infer<typeof insertDefectPhotoSchema>;
export type DefectPhoto = typeof defectPhotos.$inferSelect;

export const insertDefectActionSchema = createInsertSchema(defectActions).omit({ id: true, createdAt: true });
export type InsertDefectAction = z.infer<typeof insertDefectActionSchema>;
export type DefectAction = typeof defectActions.$inferSelect;
