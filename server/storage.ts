import { 
  users, 
  aiRequests, 
  payments, 
  broadcasts, 
  broadcastDeliveries, 
  subscriptionChecks,
  referrals,
  leadRequests,
  botSettings,
  type User, 
  type InsertUser,
  type AiRequest,
  type InsertAiRequest,
  type Payment,
  type InsertPayment,
  type Broadcast,
  type InsertBroadcast,
  type LeadRequest,
  type InsertLeadRequest
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, and, or, count, sum, ilike, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { cache } from "./cache";
export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User>;
  
  // Subscription checks
  updateUserSubscription(userId: string, isSubscribed: boolean): Promise<void>;
  
  // AI Requests
  createAiRequest(request: InsertAiRequest): Promise<AiRequest>;
  updateAiRequest(id: string, updates: Partial<AiRequest>): Promise<AiRequest>;
  getUserWeeklyRequests(userId: string, agentType: string): Promise<number>;
  
  // Payments
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: string, updates: Partial<Payment>): Promise<Payment>;
  
  // Referrals
  createReferral(referrerId: string, referredId: string): Promise<void>;
  getUserReferralCode(userId: string): Promise<string>;
  
  // Broadcasts
  createBroadcast(broadcast: InsertBroadcast): Promise<Broadcast>;
  getBroadcasts(limit?: number): Promise<Broadcast[]>;
  getTargetUsers(audience: string): Promise<User[]>;
  recordBroadcastDelivery(broadcastId: string, userId: string, status: string, errorMessage?: string): Promise<void>;
  
  // Lead Requests
  createLeadRequest(request: InsertLeadRequest): Promise<LeadRequest>;
  
  // Analytics
  getDashboardStats(): Promise<{
    totalUsers: number;
    subscribers: number;
    weeklyAiRequests: number;
    monthlyRevenue: number;
    weeklyGrowth: number;
    subscriberGrowth: number;
    aiRequestsGrowth: number;
    revenueGrowth: number;
  }>;
  
  getRecentActivity(limit?: number): Promise<Array<{
    id: string;
    type: string;
    user: string;
    action: string;
    time: Date;
  }>>;
  
  // Bot Settings
  getBotSetting(key: string): Promise<string | undefined>;
  setBotSetting(key: string, value: string): Promise<void>;
  getAllBotSettings(): Promise<Array<{ key: string; value: string; updatedAt: Date }>>;

  // User Management
  getUsers(limit: number, offset: number): Promise<User[]>;
  getUsersCount(): Promise<number>;

  // Analytics & Stats
  getAiRequestsStats(): Promise<{
    totalRequests: number;
    todayRequests: number;
    weeklyRequests: number;
    inspectorRequests: number;
    designerRequests: number;
    averageProcessingTime: number;
  }>;
  
  getPaymentsStats(): Promise<{
    totalRevenue: number;
    todayRevenue: number;
    weeklyRevenue: number;
    totalPayments: number;
    averagePayment: number;
    completedPayments: number;
    pendingPayments: number;
  }>;
  
  getReferralsStats(): Promise<{
    totalReferrals: number;
    weeklyReferrals: number;
    topReferrers: Array<{ userId: string; firstName?: string; lastName?: string; referralCount: number }>;
  }>;

  // Broadcast Management
  updateBroadcast(id: string, updates: Partial<Broadcast>): Promise<Broadcast>;

  // Maintenance
  resetWeeklyLimits(): Promise<void>;
  cleanupOldData(cutoffDate: Date): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const referralCode = randomUUID().slice(0, 8);
    const [user] = await db
      .insert(users)
      .values({ ...insertUser, referralCode })
      .returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...updates, lastActivity: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUserSubscription(userId: string, isSubscribed: boolean): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ isSubscribed }).where(eq(users.id, userId));
      await tx.insert(subscriptionChecks).values({ userId, isSubscribed });
    });
  }

  async createAiRequest(request: InsertAiRequest): Promise<AiRequest> {
    const [aiRequest] = await db
      .insert(aiRequests)
      .values(request)
      .returning();
    return aiRequest;
  }

  async updateAiRequest(id: string, updates: Partial<AiRequest>): Promise<AiRequest> {
    const [aiRequest] = await db
      .update(aiRequests)
      .set(updates)
      .where(eq(aiRequests.id, id))
      .returning();
    return aiRequest;
  }

  async getUserWeeklyRequests(userId: string, agentType: string): Promise<number> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [result] = await db
      .select({ count: count() })
      .from(aiRequests)
      .where(
        and(
          eq(aiRequests.userId, userId),
          eq(aiRequests.agentType, agentType),
          gte(aiRequests.createdAt, weekAgo)
        )
      );
    return result?.count || 0;
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [newPayment] = await db
      .insert(payments)
      .values(payment)
      .returning();
    return newPayment;
  }

  async updatePayment(id: string, updates: Partial<Payment>): Promise<Payment> {
    const [payment] = await db
      .update(payments)
      .set(updates)
      .where(eq(payments.id, id))
      .returning();
    return payment;
  }

  async createReferral(referrerId: string, referredId: string): Promise<void> {
    await db.insert(referrals).values({ referrerId, referredId });
  }

  async getUserReferralCode(userId: string): Promise<string> {
    const [user] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId));
    return user?.referralCode || '';
  }

  async createBroadcast(broadcast: InsertBroadcast): Promise<Broadcast> {
    const [newBroadcast] = await db
      .insert(broadcasts)
      .values(broadcast)
      .returning();
    return newBroadcast;
  }

  async getBroadcasts(limit = 10): Promise<Broadcast[]> {
    return db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(limit);
  }

  async getTargetUsers(audience: string): Promise<User[]> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    switch (audience) {
      case 'subscribers':
        return db.select().from(users).where(eq(users.isSubscribed, true));
      case 'active':
        return db.select().from(users).where(gte(users.lastActivity, weekAgo));
      case 'paying':
        const payingUserIds = await db
          .selectDistinct({ userId: payments.userId })
          .from(payments)
          .where(eq(payments.status, 'completed'));
        const userIds = payingUserIds.map(p => p.userId);
        return db.select().from(users).where(or(...userIds.map(id => eq(users.id, id))));
      default:
        return db.select().from(users).where(eq(users.isActive, true));
    }
  }

  async recordBroadcastDelivery(broadcastId: string, userId: string, status: string, errorMessage?: string): Promise<void> {
    await db.insert(broadcastDeliveries).values({
      broadcastId,
      userId,
      status,
      errorMessage
    });
  }

  async createLeadRequest(request: InsertLeadRequest): Promise<LeadRequest> {
    const [leadRequest] = await db
      .insert(leadRequests)
      .values(request)
      .returning();
    return leadRequest;
  }

  async getDashboardStats() {
    // Check cache first (5 minute TTL)
    const cacheKey = 'dashboard_stats';
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const [
      totalUsersResult,
      subscribersResult,
      weeklyAiRequestsResult,
      monthlyRevenueResult,
      prevWeekUsersResult,
      prevWeekSubscribersResult,
      prevWeekAiRequestsResult,
      prevMonthRevenueResult
    ] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select({ count: count() }).from(users).where(eq(users.isSubscribed, true)),
      db.select({ count: count() }).from(aiRequests).where(gte(aiRequests.createdAt, weekAgo)),
      db.select({ sum: sum(payments.amount) }).from(payments)
        .where(and(eq(payments.status, 'completed'), gte(payments.createdAt, monthAgo))),
      db.select({ count: count() }).from(users)
        .where(and(gte(users.createdAt, twoWeeksAgo), gte(users.createdAt, weekAgo))),
      db.select({ count: count() }).from(users)
        .where(and(eq(users.isSubscribed, true), gte(users.createdAt, twoWeeksAgo), gte(users.createdAt, weekAgo))),
      db.select({ count: count() }).from(aiRequests)
        .where(and(gte(aiRequests.createdAt, twoWeeksAgo), gte(aiRequests.createdAt, weekAgo))),
      db.select({ sum: sum(payments.amount) }).from(payments)
        .where(and(eq(payments.status, 'completed'), gte(payments.createdAt, twoMonthsAgo), gte(payments.createdAt, monthAgo)))
    ]);

    const totalUsers = totalUsersResult[0]?.count || 0;
    const subscribers = subscribersResult[0]?.count || 0;
    const weeklyAiRequests = weeklyAiRequestsResult[0]?.count || 0;
    const monthlyRevenue = Number(monthlyRevenueResult[0]?.sum || 0);
    
    const prevWeekUsers = prevWeekUsersResult[0]?.count || 0;
    const prevWeekSubscribers = prevWeekSubscribersResult[0]?.count || 0;
    const prevWeekAiRequests = prevWeekAiRequestsResult[0]?.count || 0;
    const prevMonthRevenue = Number(prevMonthRevenueResult[0]?.sum || 0);

    const weeklyGrowth = prevWeekUsers > 0 ? ((totalUsers - prevWeekUsers) / prevWeekUsers) * 100 : 0;
    const subscriberGrowth = prevWeekSubscribers > 0 ? ((subscribers - prevWeekSubscribers) / prevWeekSubscribers) * 100 : 0;
    const aiRequestsGrowth = prevWeekAiRequests > 0 ? ((weeklyAiRequests - prevWeekAiRequests) / prevWeekAiRequests) * 100 : 0;
    const revenueGrowth = prevMonthRevenue > 0 ? ((monthlyRevenue - prevMonthRevenue) / prevMonthRevenue) * 100 : 0;

    const result = {
      totalUsers,
      subscribers,
      weeklyAiRequests,
      monthlyRevenue,
      weeklyGrowth,
      subscriberGrowth,
      aiRequestsGrowth,
      revenueGrowth
    };

    // Cache result for 5 minutes
    cache.set(cacheKey, result, 5);
    return result;
  }

  async getRecentActivity(limit = 10) {
    // Check cache first (2 minute TTL for activity)
    const cacheKey = `recent_activity_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const activities = await db
      .select({
        id: aiRequests.id,
        type: aiRequests.agentType,
        userId: aiRequests.userId,
        createdAt: aiRequests.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username
      })
      .from(aiRequests)
      .leftJoin(users, eq(aiRequests.userId, users.id))
      .orderBy(desc(aiRequests.createdAt))
      .limit(limit);

    const result = activities.map(activity => ({
      id: activity.id,
      type: activity.type === 'inspector' ? 'inspection' : 'design',
      user: activity.firstName || activity.username || 'Unknown User',
      action: activity.type === 'inspector' ? 'Использовал ИИ-Технадзор' : 'Использовал ИИ-Дизайнер',
      time: activity.createdAt || new Date()
    }));

    // Cache result for 2 minutes
    cache.set(cacheKey, result, 2);
    return result;
  }

  async getBotSetting(key: string): Promise<string | undefined> {
    const [setting] = await db.select().from(botSettings).where(eq(botSettings.key, key));
    return setting?.value;
  }

  async setBotSetting(key: string, value: string): Promise<void> {
    await db
      .insert(botSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: botSettings.key,
        set: { value, updatedAt: new Date() }
      });
  }

  async getAllBotSettings(): Promise<Array<{ key: string; value: string; updatedAt: Date }>> {
    return db.select({
      key: botSettings.key,
      value: botSettings.value,
      updatedAt: botSettings.updatedAt
    }).from(botSettings).then(results => 
      results.map(r => ({
        ...r,
        updatedAt: r.updatedAt || new Date()
      }))
    );
  }

  async getUsers(limit: number, offset: number): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
  }

  async getUsersCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(users);
    return result?.count || 0;
  }

  async getAiRequestsStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalRequestsResult,
      todayRequestsResult,
      weeklyRequestsResult,
      inspectorRequestsResult,
      designerRequestsResult,
      avgProcessingTimeResult
    ] = await Promise.all([
      db.select({ count: count() }).from(aiRequests),
      db.select({ count: count() }).from(aiRequests).where(gte(aiRequests.createdAt, today)),
      db.select({ count: count() }).from(aiRequests).where(gte(aiRequests.createdAt, weekAgo)),
      db.select({ count: count() }).from(aiRequests).where(eq(aiRequests.agentType, 'inspector')),
      db.select({ count: count() }).from(aiRequests).where(eq(aiRequests.agentType, 'designer')),
      db.select({ avg: sum(aiRequests.processingTime) }).from(aiRequests).where(gte(aiRequests.createdAt, weekAgo))
    ]);

    return {
      totalRequests: totalRequestsResult[0]?.count || 0,
      todayRequests: todayRequestsResult[0]?.count || 0,
      weeklyRequests: weeklyRequestsResult[0]?.count || 0,
      inspectorRequests: inspectorRequestsResult[0]?.count || 0,
      designerRequests: designerRequestsResult[0]?.count || 0,
      averageProcessingTime: Number(avgProcessingTimeResult[0]?.avg || 0)
    };
  }

  async getPaymentsStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalRevenueResult,
      todayRevenueResult,
      weeklyRevenueResult,
      totalPaymentsResult,
      avgPaymentResult,
      completedPaymentsResult,
      pendingPaymentsResult
    ] = await Promise.all([
      db.select({ sum: sum(payments.amount) }).from(payments).where(eq(payments.status, 'completed')),
      db.select({ sum: sum(payments.amount) }).from(payments)
        .where(and(eq(payments.status, 'completed'), gte(payments.createdAt, today))),
      db.select({ sum: sum(payments.amount) }).from(payments)
        .where(and(eq(payments.status, 'completed'), gte(payments.createdAt, weekAgo))),
      db.select({ count: count() }).from(payments),
      db.select({ avg: sum(payments.amount) }).from(payments).where(eq(payments.status, 'completed')),
      db.select({ count: count() }).from(payments).where(eq(payments.status, 'completed')),
      db.select({ count: count() }).from(payments).where(eq(payments.status, 'pending'))
    ]);

    const totalPayments = totalPaymentsResult[0]?.count || 0;
    const completedPayments = completedPaymentsResult[0]?.count || 0;
    
    return {
      totalRevenue: Number(totalRevenueResult[0]?.sum || 0),
      todayRevenue: Number(todayRevenueResult[0]?.sum || 0),
      weeklyRevenue: Number(weeklyRevenueResult[0]?.sum || 0),
      totalPayments,
      averagePayment: completedPayments > 0 ? Number(avgPaymentResult[0]?.avg || 0) / completedPayments : 0,
      completedPayments,
      pendingPayments: pendingPaymentsResult[0]?.count || 0
    };
  }

  async getReferralsStats() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalReferralsResult,
      weeklyReferralsResult,
      topReferrersResult
    ] = await Promise.all([
      db.select({ count: count() }).from(referrals),
      db.select({ count: count() }).from(referrals).where(gte(referrals.createdAt, weekAgo)),
      db.select({
        userId: referrals.referrerId,
        referralCount: count(),
        firstName: users.firstName,
        lastName: users.lastName
      })
        .from(referrals)
        .leftJoin(users, eq(referrals.referrerId, users.id))
        .groupBy(referrals.referrerId, users.firstName, users.lastName)
        .orderBy(desc(count()))
        .limit(10)
    ]);

    return {
      totalReferrals: totalReferralsResult[0]?.count || 0,
      weeklyReferrals: weeklyReferralsResult[0]?.count || 0,
      topReferrers: topReferrersResult.map(r => ({
        userId: r.userId,
        firstName: r.firstName || undefined,
        lastName: r.lastName || undefined,
        referralCount: r.referralCount
      }))
    };
  }

  async updateBroadcast(id: string, updates: Partial<Broadcast>): Promise<Broadcast> {
    const [broadcast] = await db
      .update(broadcasts)
      .set(updates)
      .where(eq(broadcasts.id, id))
      .returning();
    return broadcast;
  }

  async resetWeeklyLimits(): Promise<void> {
    // This would reset user weekly limits - for now we'll just update the lastActivity
    // In a real implementation, you might have a separate table for tracking weekly limits
    await db.update(users).set({ lastActivity: new Date() });
  }

  async cleanupOldData(cutoffDate: Date): Promise<void> {
    // Clean up old AI requests older than cutoff date
    await db.delete(aiRequests).where(gte(aiRequests.createdAt, cutoffDate));
    
    // Clean up old subscription checks
    await db.delete(subscriptionChecks).where(gte(subscriptionChecks.checkedAt, cutoffDate));
    
    // Clean up old broadcast deliveries
    await db.delete(broadcastDeliveries).where(gte(broadcastDeliveries.deliveredAt, cutoffDate));
  }


  async listDefects(opts: {
    assigneeId?: string;
    status?: ("on_control" | "discovered" | "fixed")[];
    dueBefore?: Date;
    dueAfter?: Date;
    limit?: number;
    offset?: number;
    order?: "due" | "created";
  }) {
    const limit  = Math.max(1, Math.min(50, opts.limit ?? 5));
    const offset = opts.offset ?? 0;

    const parts: any[] = [];
    if (opts.assigneeId)              parts.push(_eq(_defects.assignedTo, opts.assigneeId));
    if (opts.status && opts.status.length) parts.push(_inArray(_defects.status as any, opts.status as any));
    if (opts.dueBefore)               parts.push(_lt(_defects.dueDate, opts.dueBefore));
    if (opts.dueAfter)                parts.push(_gte(_defects.dueDate, opts.dueAfter));

    const whereExpr = parts.length ? _and(...parts) : undefined;

    const rows = await db
      .select()
      .from(_defects)
      .where(whereExpr)
      .orderBy(opts.order === "created" ? _sql`${_defects.createdAt} desc` : _sql`${_defects.dueDate} asc nulls last`)
      .limit(limit)
      .offset(offset);

    const [{ c: total = 0 } = {} as any] = await db
      .select({ c: _count() })
      .from(_defects)
      .where(whereExpr);

    return { rows, total: Number(total), limit, offset };
  }

  async incrementUserPurchasedRequests(userId: string, delta: number) {
    // совместимо и с this.db, и с импортированным db
    const q = (this as any).db ?? db;

    await q
      .update(users)
      .set({
        totalPurchasedRequests: sql`${users.totalPurchasedRequests} + ${delta}`,
      })
      .where(eq(users.id, userId));

    const rows = await q
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return rows[0] ?? null; // <— без вызова несуществующего this.getUserById
  }
}

import {
  defects, defectPhotos, defectActions,
  type InsertDefect, type InsertDefectPhoto, type InsertDefectAction,
} from "@shared/schema";

/** Создать дефект + лог + initial/before фото */
export async function createDefect(input: InsertDefect & {
  createdByUserId: string;
  photos?: { telegramFileId: string; type?: "initial" | "before" }[];
}) {
  const { photos, humanId: _drop, createdByUserId, ...rest } = input;

  const toInsert = {
    ...rest,                // здесь уже НЕТ ни photos, ни humanId
    createdByUserId,        // явно прописываем колонку
    // humanId не передаём — БД сгенерит дефолт D-000001
  } satisfies typeof defects.$inferInsert;

  const [defect] = await db.insert(defects).values(toInsert).returning();

  if (photos?.length) {
    const rows = photos.map(p => ({
      defectId: defect.id,
      type: (p.type ?? "initial") as any,
      telegramFileId: p.telegramFileId,
      createdByUserId,
    }));
    await db.insert(defectPhotos).values(rows);
    await db.insert(defectActions).values({
      defectId: defect.id,
      actorUserId: createdByUserId,
      action: "add_photo",
      payload: { count: rows.length, types: rows.map(r => r.type) },
    });
  }

  await db.insert(defectActions).values({
    defectId: defect.id,
    actorUserId: createdByUserId,
    action: "create",
    payload: {
      status: defect.status,
      category: defect.category,
      severity: defect.severity,
    },
  });

  return defect;
}

/** Получить по #ID (human_id) */
export async function getDefectByHumanId(humanId: string) {
  const [row] = await db.select().from(defects).where(eq(defects.humanId, humanId)).limit(1);
  return row ?? null;
}

/** Получить по id */
export async function getDefectById(id: string) {
  const [row] = await db.select().from(defects).where(eq(defects.id, id)).limit(1);
  return row ?? null;
}

/** Добавить фото (before/after) */
export async function addDefectPhoto(input: InsertDefectPhoto & { actorUserId: string }) {
  const [row] = await db.insert(defectPhotos).values({
    defectId: input.defectId,
    type: input.type,
    telegramFileId: input.telegramFileId,
    createdByUserId: input.createdByUserId,
  }).returning();

  await db.insert(defectActions).values({
    defectId: input.defectId,
    actorUserId: input.actorUserId,
    action: "add_photo",
    payload: { type: input.type },
  });

  return row;
}

/** Сменить статус (с аудитом) */
export async function updateDefectStatus(defectId: string, nextStatus: "discovered"|"on_control"|"fixed"|"awaiting_review", actorUserId: string) {
  const now = new Date();
  const update: Partial<typeof defects.$inferInsert> = {
    status: nextStatus,
    updatedAt: now,
    ...(nextStatus === "fixed" ? { closedAt: now } : {}),
  };

  const [row] = await db.update(defects).set(update).where(eq(defects.id, defectId)).returning();

  await db.insert(defectActions).values({
    defectId,
    actorUserId,
    action: "status_change",
    payload: { to: nextStatus },
  });

  return row;
}

/** Назначить ответственного (с аудитом) */
export async function assignDefect(defectId: string, assigneeUserId: string, actorUserId: string) {
  const [row] = await db.update(defects)
    .set({ assigneeUserId, updatedAt: new Date() })
    .where(eq(defects.id, defectId))
    .returning();

  await db.insert(defectActions).values({
    defectId,
    actorUserId,
    action: "assign",
    payload: { assigneeUserId },
  });

  return row;
}

/** Поиск (минимальный, дальше расширим) */
export async function listDefects(params: {
  q?: string;
  status?: ("discovered"|"on_control"|"fixed"|"awaiting_review")[];
  category?: ("architecture"|"structural"|"electrical"|"plumbing"|"finishing"|"landscaping")[];
  severity?: ("critical"|"medium"|"low")[];
  assigneeUserId?: string;
  object?: string;
  limit?: number;
  cursorCreatedAt?: string; // keyset пагинация
}) {
  const where = [];

  if (params.q) {
    where.push(ilike(defects.description, `%${params.q}%`));
  }
  if (params.status?.length) {
    where.push(sql`${defects.status} = ANY(${params.status})`);
  }
  if (params.category?.length) {
    where.push(sql`${defects.category} = ANY(${params.category})`);
  }
  if (params.severity?.length) {
    where.push(sql`${defects.severity} = ANY(${params.severity})`);
  }
  if (params.assigneeUserId) {
    where.push(eq(defects.assigneeUserId, params.assigneeUserId));
  }
  if (params.object) {
    where.push(ilike(defects.object, `%${params.object}%`));
  }

  const limit = Math.min(params.limit ?? 20, 100);

  const rows = await db
    .select()
    .from(defects)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(defects.createdAt))
    .limit(limit);

  return rows;
}


export const storage = new DatabaseStorage();

// ==== LIST QUERIES ====
import { and as _and, eq as _eq, gte as _gte, lt as _lt, sql as _sql, count as _count, inArray as _inArray } from "drizzle-orm";
import { defects as _defects } from "@shared/schema";

type ListOpts = {
  assigneeId?: string;
  status?: ("on_control" | "discovered" | "fixed")[];
  dueBefore?: Date;
  dueAfter?: Date;
  limit?: number;
  offset?: number;
  order?: "due" | "created";
};

export async function listDefectsPaged(opts: ListOpts) {
  const limit = opts.limit ?? 10;
  const offset = opts.offset ?? 0;

  const parts: any[] = [];
  if (opts.assigneeId) parts.push(_eq(_defects.assignedTo, opts.assigneeId));
  if (opts.status && opts.status.length) parts.push(_inArray(_defects.status as any, opts.status as any));
  if (opts.dueBefore) parts.push(_lt(_defects.dueDate, opts.dueBefore));
  if (opts.dueAfter)  parts.push(_gte(_defects.dueDate, opts.dueAfter));

  const whereExpr = parts.length ? _and(...parts) : undefined;

  const rows = await db
    .select()
    .from(_defects)
    .where(whereExpr)
    .orderBy(opts.order === "created" ? _sql`${_defects.createdAt} desc` : _sql`${_defects.dueDate} asc nulls last`)
    .limit(limit)
    .offset(offset);

  const [{ c: total = 0 } = {} as any] = await db
    .select({ c: _count() })
    .from(_defects)
    .where(whereExpr);

  return { rows, total: Number(total), limit, offset };
}

// ✅ РАСШИРЕННАЯ: дефект + кол-во фото (для карточки)
export async function getDefectWithCountsByHumanId(humanId: string) {
  const [defect] = await db.select().from(defects).where(eq(defects.humanId, humanId)).limit(1);
  if (!defect) return null;

  const [{ c: initCount = 0 } = {} as any] = await db
    .select({ c: count() })
    .from(defectPhotos)
    .where(and(eq(defectPhotos.defectId, defect.id), eq(defectPhotos.type, "initial" as any)));

  const [{ c: afterCount = 0 } = {} as any] = await db
    .select({ c: count() })
    .from(defectPhotos)
    .where(and(eq(defectPhotos.defectId, defect.id), eq(defectPhotos.type, "after" as any)));

  return {
    defect,
    photos: { initial: Number(initCount), after: Number(afterCount) },
  };
}

/** Добавить фото к дефекту (initial|after) */
export async function addDefectPhotosBulk(params: {
  defectId: string;
  type: "initial" | "after";
  telegramFileIds: string[];
  createdByUserId: string;
}) {
  if (!params.telegramFileIds.length) return 0;
  const values = params.telegramFileIds.map((id) => ({
    defectId: params.defectId,
    type: params.type as any,
    telegramFileId: id,
    createdByUserId: params.createdByUserId,
  }));
  await db.insert(defectPhotos).values(values);
  await db.insert(defectActions).values({
    defectId: params.defectId,
    actorUserId: params.createdByUserId,
    action: "add_photo",
    payload: { type: params.type, count: params.telegramFileIds.length },
  });
  return values.length;
}

/** Сменить статус по humanId (с журналом), можно потребовать наличие after-фото */
export async function updateDefectStatusByHumanId(opts: {
  humanId: string;
  to: "discovered" | "on_control" | "fixed";
  actorUserId: string;
  requireAfter?: boolean;
}) {
  const rows = await db.select().from(defects).where(eq(defects.humanId, opts.humanId)).limit(1);
  const d = rows[0];
  if (!d) return { ok: false as const, reason: "not_found" };

  if (opts.requireAfter) {
    const afterCnt = await db.select({ c: count() })
      .from(defectPhotos)
      .where(and(eq(defectPhotos.defectId, d.id), eq(defectPhotos.type, "after" as any)));
    if (Number(afterCnt[0]?.c ?? 0) < 1) {
      return { ok: false as const, reason: "no_after_photos" };
    }
  }

  const [updated] = await db.update(defects)
    .set({ status: opts.to, updatedAt: sql`now()` })
    .where(eq(defects.id, d.id))
    .returning();

  await db.insert(defectActions).values({
    defectId: d.id,
    actorUserId: opts.actorUserId,
    action: "status_change",
    payload: { from: d.status, to: opts.to },
  });

  return { ok: true as const, defect: updated };
}

/** Назначить ответственного по humanId */
export async function assignDefectByHumanId(humanId: string, assignedTo: string, actorUserId: string) {
  const [row] = await db.update(defects)
    .set({ assignedTo, updatedAt: sql`now()` })
    .where(eq(defects.humanId, humanId))
    .returning();
  if (!row) return { ok: false as const, reason: "not_found" };

  await db.insert(defectActions).values({
    defectId: row.id,
    actorUserId,
    action: "assign",
    payload: { to: assignedTo },
  });

  return { ok: true as const, defect: row };
}

/** Снять ответственного по humanId */
export async function unassignDefectByHumanId(humanId: string, actorUserId: string) {
  const [row] = await db.update(defects)
    .set({ assignedTo: null, updatedAt: sql`now()` })
    .where(eq(defects.humanId, humanId))
    .returning();
  if (!row) return { ok: false as const, reason: "not_found" };

  await db.insert(defectActions).values({
    defectId: row.id,
    actorUserId,
    action: "assign_clear",
    payload: {},
  });

  return { ok: true as const, defect: row };
}

/** Установить срок по humanId */
export async function setDefectDueDateByHumanId(humanId: string, dueDateISO: string, actorUserId: string) {
  const [row] = await db.update(defects)
    .set({ dueDate: sql`${dueDateISO}::timestamptz`, updatedAt: sql`now()` })
    .where(eq(defects.humanId, humanId))
    .returning();
  if (!row) return { ok: false as const, reason: "not_found" };

  await db.insert(defectActions).values({
    defectId: row.id,
    actorUserId,
    action: "due_change",
    payload: { due: dueDateISO },
  });

  return { ok: true as const, defect: row };
}

// ========= REPORT QUERIES (PDF/Excel) =========
import { defects as R_defects, defectActions as R_actions, defectPhotos as R_photos } from "@shared/schema";

/** Сводка: сколько ОБНАРУЖЕНО (создано), переведено НА КОНТРОЛЬ и УСТРАНЕНО в периоде */
export async function getReportStats(from: Date, to: Date) {
  const [discoveredRow] = await db
    .select({ c: count() })
    .from(R_defects)
    .where(sql`${R_defects.createdAt} BETWEEN ${from} AND ${to}`);

  const [fixedRow] = await db
    .select({ c: count() })
    .from(R_actions)
    .where(sql`${R_actions.createdAt} BETWEEN ${from} AND ${to} AND ${R_actions.action} = 'status_change' AND (payload->>'to') = 'fixed'`);

  const [onControlRow] = await db
    .select({ c: count() })
    .from(R_actions)
    .where(sql`${R_actions.createdAt} BETWEEN ${from} AND ${to} AND ${R_actions.action} = 'status_change' AND (payload->>'to') = 'on_control'`);

  return {
    discovered: Number((discoveredRow as any)?.c ?? 0),
    fixed: Number((fixedRow as any)?.c ?? 0),
    on_control: Number((onControlRow as any)?.c ?? 0),
  };
}

/** Группировка по категориям среди созданных в периоде */
export async function getReportByCategory(from: Date, to: Date) {
  const rows = await db
    .select({ category: R_defects.category, c: count() })
    .from(R_defects)
    .where(sql`${R_defects.createdAt} BETWEEN ${from} AND ${to}`)
    .groupBy(R_defects.category);
  return rows.map(r => ({ category: (r as any).category ?? "—", count: Number((r as any).c) }));
}

/** Группировка по критичности среди созданных в периоде */
export async function getReportBySeverity(from: Date, to: Date) {
  const rows = await db
    .select({ severity: R_defects.severity, c: count() })
    .from(R_defects)
    .where(sql`${R_defects.createdAt} BETWEEN ${from} AND ${to}`)
    .groupBy(R_defects.severity);
  return rows.map(r => ({ severity: (r as any).severity ?? "—", count: Number((r as any).c) }));
}

/** Топ критичных кейсов с одной фоткой (initial/before), созданных в периоде */
export async function getTopCriticalDefects(from: Date, to: Date, limit = 6) {
  const ds = await db
    .select()
    .from(R_defects)
    .where(sql`${R_defects.severity} = 'critical' AND ${R_defects.createdAt} BETWEEN ${from} AND ${to}`)
    .orderBy(sql`${R_defects.createdAt} DESC`)
    .limit(limit);

  const out: Array<{ id: string; humanId: string; object?: string | null; createdAt: string; status: string; photoFileId?: string | null }> = [];
  for (const d of ds as any[]) {
    const [ph] = await db
      .select()
      .from(R_photos)
      .where(sql`${R_photos.defectId} = ${d.id} AND ${R_photos.type} IN ('initial','before')`)
      .orderBy(sql`${R_photos.createdAt} ASC`)
      .limit(1);

    out.push({
      id: d.id,
      humanId: d.humanId,
      object: d.object ?? null,
      createdAt: String(d.createdAt),
      status: d.status,
      photoFileId: (ph as any)?.telegramFileId ?? null,
    });
  }
  return out;
}

// === Photos for a defect (for sending in chat) ===
import { eq as R_eq } from "drizzle-orm";

export type RepoPhoto = { telegramFileId: string; type: "initial"|"before"|"after"; createdAt: Date };

export async function getDefectPhotosAll(defectId: string): Promise<RepoPhoto[]> {
  const rows = await db
    .select({
      telegramFileId: R_photos.telegramFileId,
      type: R_photos.type,
      createdAt: R_photos.createdAt,
    })
    .from(R_photos)
    .where(R_eq(R_photos.defectId, defectId))
    // сначала 'initial'/'before', затем 'after', внутри — по дате
    .orderBy(R_photos.type, R_photos.createdAt);

  return rows as any;
}