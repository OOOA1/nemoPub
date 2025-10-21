import { Context } from 'telegraf';
import { storage } from './storage';
import { updateUserSubscriptionStatus } from './subscriptionChecker';
import { getDefectPhotosAll } from "./storage";
import { sendLeadEmail } from "./mailer";
import { Markup } from "telegraf";

import {
  setFlowState, getFlowState, clearFlowState,
  getLeadData, setLeadData, clearLeadData
} from "./leadFlow";

import {
  getDefectByHumanId,
  addDefectPhotosBulk,
  updateDefectStatusByHumanId,
  getDefectWithCountsByHumanId,
  assignDefect,
  assignDefectByHumanId,         // ← новое имя
  setDefectDueDateByHumanId,
} from "./storage";
import { getAfterMode } from "./afterMode";
// Локальный логгер для новых хендлеров (не конфликтует с чужими reportError)
function defReportError(ctx: Context, where: string, err: unknown) {
  try { console.error(`[defect-master][${where}]`, err); } catch {}
  try { ctx.reply("🙈 Упс! Что-то пошло не так. Попробуйте ещё раз."); } catch {}
}

// --- Глобальный кэш режима «после»
const afterMode = new Map<number, { defectId: number; startedAt: number }>();
const AFTER_TTL_MS = 15 * 60 * 1000; // 15 минут

function clearAfterMode(userId: number) {
  afterMode.delete(userId);
}

function setAfterMode(userId: number, defectId: number) {
  afterMode.set(userId, { defectId, startedAt: Date.now() });
}

function getActiveAfter(userId: number) {
  const s = afterMode.get(userId);
  if (!s) return null;
  if (Date.now() - s.startedAt > AFTER_TTL_MS) {
    afterMode.delete(userId);
    return null;
  }
  return s;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const RE_ID = /\b#?(D-\d{6})\b/i;
const RE_FIXED_CAPTION = /\b(устранен[оа]?|закрыт[оа]?|fixed)\b.*\b#?(D-\d{6})\b/i;
export const controlKeyFor = (uid: number | string) => `control_wizard_${uid}`;

// хелпер: округлить срок к 23:59:59 локального дня и вернуть ISO (UTC)
function toISODateLocal(daysFromNow = 0) {
  const d = new Date();
  d.setHours(23, 59, 59, 0);
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

// спросить срок устранения
export async function askDue(ctx: Context, humanId: string) {
  await ctx.reply(
    `Срок устранения для #${humanId}?`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Сегодня", callback_data: `def_due_today:${humanId}` },
            { text: "+1 день",  callback_data: `def_due_p1:${humanId}` },
            { text: "+3 дня",   callback_data: `def_due_p3:${humanId}` },
          ],
          [{ text: "🗓 Своя дата", callback_data: `def_due_custom:${humanId}` }],
          [{ text: "❌ Отмена",     callback_data: `def_ctl_cancel:${humanId}` }],
        ],
      },
    }
  );
}

// Очередь на пользователя, чтобы не было гонок
const photoLocks = new Map<number, Promise<void>>();
function runWithUserLock(userId: number, task: () => Promise<void>) {
  const prev = photoLocks.get(userId) ?? Promise.resolve();
  const next = prev.then(task).catch(() => {}).finally(() => {
    // очистка, если этот промис всё ещё последний
    if (photoLocks.get(userId) === next) photoLocks.delete(userId);
  });
  photoLocks.set(userId, next);
  return next;
}

// Дебаунсеры
const albumTimers = new Map<string, NodeJS.Timeout>(); // `${userId}:${media_group_id}`
const singleTimers = new Map<number, NodeJS.Timeout>(); // по userId

function clearDefectTimersFor(userId: number) {
  // Чистим одиночный таймер
  const st = singleTimers.get(userId);
  if (st) {
    clearTimeout(st);
    singleTimers.delete(userId);
  }

  // Чистим альбомные таймеры этого пользователя
  albumTimers.forEach((t, key) => {
    if (key.startsWith(`${userId}:`)) {
      clearTimeout(t);
      albumTimers.delete(key);
    }
  });
}

export async function handleStart(ctx: Context) {
  // Only answer callback query if this is actually a callback query
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  ctx.reply(
    '👋 Добро пожаловать в NEMO Moscow.\n' +
    'Мы занимаемся ремонтом под ключ, авторским надзором и дизайн-проектами.\n' +
    '🛡️ ИИ-Технадзор — попробуй бесплатно.\n' + 
    'Работаем с 2011 года. Прозрачно. Стильно. С гарантией.',
    {
      reply_markup: {
      inline_keyboard: [
        [{ text: '🏗 Ремонт под ключ', callback_data: 'renovation' }],
        [{ text: '🛡️ ИИ-Технадзор',    callback_data: 'inspector' }],
        [{ text: '🎨 ИИ-Дизайнер',     callback_data: 'designer' }],
        [{ text: '📸 Фотофиксация дефекта', callback_data: 'defect_start' }],
        [{ text: "📋 Задачи", callback_data: "lists_menu" }],
        [{ text: '📑 Отчёты', callback_data: 'reports' }],
        [{ text: 'ℹ️ Как мы работаем', callback_data: 'how_we_work' }],
        [{ text: '🌐 Перейти на сайт', callback_data: 'website' }, { text: '🗺 Наш офис', callback_data: 'office' }],
        [{ text: '☎️ Консультация специалиста', callback_data: 'leave_request' }],
      ]
      }
    }
  );
}

export async function handleSubscriptionCheck(ctx: Context) {
  await ctx.answerCbQuery();
  
  const user = (ctx as any).user;
  if (!user) return;

  const isSubscribed = await updateUserSubscriptionStatus(user.id, user.telegramId);
  
  if (isSubscribed) {
    ctx.reply(
      '✅ Отлично! Подписка подтверждена.\n' +
      'Теперь вы можете пользоваться ИИ-агентами.\n\n' +
      'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👀 ИИ-Технадзор', callback_data: 'inspector' }],
            [{ text: '🎨 ИИ-Дизайнер', callback_data: 'designer' }],
            [{ text: '🏠 Главное меню', callback_data: 'start' }]
          ]
        }
      }
    );
  } else {
    ctx.reply(
      '❌ Подписка не обнаружена.\n' +
      'Убедитесь, что вы подписались на канал @nemo_moscow_channel\n\n' +
      'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Я подписался', callback_data: 'check_subscription' }],
            [{ text: '🏠 Главное меню', callback_data: 'start' }]
          ]
        }
      }
    );
  }
}

export async function handleRenovation(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  ctx.reply(
    'Мы берём на себя весь цикл работ — от черновой отделки до финальной меблировки.\n' +
    'Сроки от 2 месяцев. Гарантия 3 года.\n\n' +
    'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
    {
      reply_markup: {
        inline_keyboard: [
          // [{ text: 'Что входит в ремонт', callback_data: 'renovation_includes' }],
          [{ text: 'Как мы контролируем качество', callback_data: 'quality_control' }],
          [{ text: 'Консультация специалиста', callback_data: 'leave_request' }],
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

export async function handleInspector(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  const user = (ctx as any).user;
  const uid = ctx.from!.id;
  await storage.setBotSetting(`defect_draft_${uid}`, "");
  await storage.setBotSetting(afterKeyFor(uid), "");
  await storage.setBotSetting(`agent_state_${uid}`, JSON.stringify({ agent: "inspector" }));
  clearDefectTimersFor(uid);

  await ctx.reply("📸 Загрузите фото для проверки. ИИ-Технадзор проанализирует его.");

  if (!user) return;

  // Temporarily skip subscription check
  // const isSubscribed = await updateUserSubscriptionStatus(user.id, user.telegramId);
  // if (!isSubscribed) {
  //   ctx.reply(
  //     'Чтобы пользоваться ИИ-Технадзором, подпишитесь на наш канал:\n' +
  //     '👉 @nemo_moscow_channel\n\n' +
  //     'После подписки нажмите «Я подписался».\n\n' +
  //     'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
  //     {
  //       reply_markup: {
  //         inline_keyboard: [
  //           [{ text: '✅ Я подписался', callback_data: 'check_subscription' }],
  //           [{ text: '🏠 Главное меню', callback_data: 'start' }]
  //         ]
  //       }
  //     }
  //   );
  //   return;
  // }

  // Check weekly limits
  const weeklyRequests = await storage.getUserWeeklyRequests(user.id, 'inspector');
  const totalLimit = 10 + user.totalPurchasedRequests;
  
  if (weeklyRequests >= totalLimit) {
    await ctx.reply(
      [
        "⚠️ Недельный лимит исчерпан.",
        "",
        "Можно докупить ещё 10 фотографий в технадзоре за 990 ₽.",
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Купить 10 фото — 990 ₽", callback_data: "buy_pack_10" }],
          ],
        },
      }
    );
    return;
  }

  // Set agent state for photo upload
  await storage.setBotSetting(`agent_state_${user.id}`, JSON.stringify({ agent: 'inspector' }));
  
  ctx.reply(
    '📸 Загрузите 1 фото вашего ремонта.\n' +
    'ИИ-Технадзор отметит возможные недочёты и даст рекомендации.\n\n' +
    '⚠️ Ограничения:\n' +
    '— 1 фото за раз\n' +
    '— до 10 проверок в неделю\n\n' +
    `Остается попыток: ${totalLimit - weeklyRequests}\n\n` +
    'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

export async function handleDesigner(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  const user = (ctx as any).user;

  const uid = ctx.from!.id;
  await storage.setBotSetting(`defect_draft_${uid}`, "");
  await storage.setBotSetting(afterKeyFor(uid), "");
  await storage.setBotSetting(`agent_state_${uid}`, JSON.stringify({ agent: "designer" }));
  clearDefectTimersFor(uid);

  if (!user) return;

  // Temporarily skip subscription check
  // const isSubscribed = await updateUserSubscriptionStatus(user.id, user.telegramId);
  // if (!isSubscribed) {
  //   ctx.reply(
  //     'Чтобы пользоваться ИИ-Дизайнером, подпишитесь на наш канал:\n' +
  //     '👉 @nemo_moscow_channel\n\n' +
  //     'После подписки нажмите «Я подписался».\n\n' +
  //     'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
  //     {
  //       reply_markup: {
  //         inline_keyboard: [
  //           [{ text: '✅ Я подписался', callback_data: 'check_subscription' }],
  //           [{ text: '🏠 Главное меню', callback_data: 'start' }]
  //         ]
      //     }
  //   );
  //   return;
  // }

  // Check weekly limits
  const weeklyRequests = await storage.getUserWeeklyRequests(user.id, 'designer');
  const totalLimit = 1 + user.totalPurchasedRequests;
  
  if (weeklyRequests >= totalLimit) {
    await ctx.reply(
      [
        "⚠️ Недельный лимит исчерпан.",
        "",
        "Можно докупить ещё 10 фотографий в технадзоре за 990 ₽.",
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Купить 10 фото — 990 ₽", callback_data: "buy_pack_10" }],
          ],
        },
      }
    );
    return;
  }
  // Start design quiz
  ctx.reply(
    '🎨 Ответьте на несколько вопросов и загрузите фото комнаты.\n' +
    'ИИ-Дизайнер покажет, как может выглядеть интерьер в новом стиле.\n\n' +
    '⚠️ Ограничения:\n' +
    '— 1 фото за раз\n' +
    '— до 10 генераций в неделю\n\n' +
    `Остается попыток: ${totalLimit - weeklyRequests}\n\n` +
    '❓ Какой стиль вам ближе?',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Минимализм', callback_data: 'style_minimalism' }],
          [{ text: 'Лофт', callback_data: 'style_loft' }],
          [{ text: 'Классика', callback_data: 'style_classic' }],
          [{ text: 'Сканди', callback_data: 'style_scandi' }],
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

export async function handleHowWeWork(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  ctx.reply(
    'Мы выстраиваем процесс просто и прозрачно:\n\n' +
    '1️⃣ Бесплатный выезд инженера\n' +
    '2️⃣ Подробная смета\n' +
    '3️⃣ Договор с фиксированной ценой\n' +
    '4️⃣ Реализация + авторский надзор\n' +
    '5️⃣ Сдача объекта и гарантия\n\n' +
    'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '☎️ Обсудить свой объект', callback_data: 'leave_request' }],
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}



export async function handleLeaveRequest(ctx: Context) {
  await setFlowState(ctx.from!.id, "lead:name");
  await clearLeadData(ctx.from!.id);
  if ("answerCbQuery" in ctx) await (ctx as any).answerCbQuery();
  await (ctx as any).reply(
    "📝 Заполните форму для консультации специалиста.\n\n👤 Введите ваше имя:"
  );
}

export async function handleReferral(ctx: Context) {
  const user = (ctx as any).user;
  if (!user) return;

  const referralCode = await storage.getUserReferralCode(user.id);
  const referralLink = `https://t.me/${process.env.BOT_USERNAME || 'nemo_moscow_bot'}?start=ref_${referralCode}`;
  
  // Get referral stats
  // const referralStats = await storage.getReferralStats(user.id);
  const referralStats = { totalReferrals: 0, bonusesGranted: 0 }; // Temporary mock

  ctx.reply(
    '👥 Приглашайте друзей и получайте бонусы!\n\n' +
    `🔗 Ваша персональная ссылка:\n${referralLink}\n\n` +
    '🎁 За каждого друга, который подпишется и попробует бота — +1 попытка.\n\n' +
    `📊 Статистика:\n` +
    `• Приглашено друзей: ${referralStats.totalReferrals}\n` +
    `• Получено бонусов: ${referralStats.bonusesGranted}\n\n` +
    'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

function validateAndNormalizeRuPhone(input: string): string | null {
  const raw = input.trim();

  // Вариант 1: +79XXXXXXXXX
  if (/^\+79\d{9}$/.test(raw)) return raw;

  // Вариант 2: 89XXXXXXXXX  -> нормализуем в +79XXXXXXXXX
  const digits = raw.replace(/\D/g, "");
  if (/^89\d{9}$/.test(digits)) return `+7${digits.slice(1)}`;

  return null;
}

export async function handleLimitsCheck(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  const user = (ctx as any).user;
  if (!user) return;

  const [inspectorRequests, designerRequests] = await Promise.all([
    storage.getUserWeeklyRequests(user.id, 'inspector'),
    storage.getUserWeeklyRequests(user.id, 'designer')
  ]);

  const baseLimit = 10;
  const totalLimit = baseLimit + user.totalPurchasedRequests;
  
  ctx.reply(
    '📊 Ваши лимиты на неделю:\n\n' +
    `👀 ИИ-Технадзор: ${inspectorRequests}/${totalLimit}\n` +
    `🎨 ИИ-Дизайнер: ${designerRequests}/${totalLimit}\n\n` +
    `💎 Базовый лимит: ${baseLimit}/неделя\n` +
    `🛒 Докуплено: ${user.totalPurchasedRequests}\n\n` +
    'Лимиты обновляются каждый понедельник.\n\n' +
    'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Докупить попытки', callback_data: 'buy_requests' }],
          [{ text: '👥 Пригласить друзей', callback_data: 'referrals' }],
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

// Design quiz handlers
export async function handleStyleSelection(ctx: Context, style: string) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  const user = (ctx as any).user;
  if (!user) return;

  await storage.setBotSetting(`design_quiz_${user.id}`, JSON.stringify({ style }));

  const styleNames: { [key: string]: string } = {
    minimalism: 'Минимализм',
    loft: 'Лофт', 
    classic: 'Классика',
    scandi: 'Сканди'
  };

  ctx.reply(
    `✅ Выбран стиль: ${styleNames[style] || style}\n\n` +
    '❓ Что для вас важнее?',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Долговечность', callback_data: 'priority_durability' }],
          [{ text: 'Уют', callback_data: 'priority_comfort' }],
          [{ text: 'Эстетика', callback_data: 'priority_aesthetics' }],
          [{ text: 'Скорость', callback_data: 'priority_speed' }]
        ]
      }
    }
  );
}

export async function handlePrioritySelection(ctx: Context, priority: string) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  const user = (ctx as any).user;
  if (!user) return;

  const quizData = await storage.getBotSetting(`design_quiz_${user.id}`);
  const quiz = quizData ? JSON.parse(quizData) : {};
  quiz.priority = priority;
  
  await storage.setBotSetting(`design_quiz_${user.id}`, JSON.stringify(quiz));

  const priorityNames: { [key: string]: string } = {
    durability: 'Долговечность',
    comfort: 'Уют',
    aesthetics: 'Эстетика',
    speed: 'Скорость'
  };

  ctx.reply(
    `✅ Приоритет: ${priorityNames[priority] || priority}\n\n` +
    '❓ Сделать акцент на:',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Освещении', callback_data: 'accent_lighting' }],
          [{ text: 'Мебели', callback_data: 'accent_furniture' }],
          [{ text: 'Материалах', callback_data: 'accent_materials' }]
        ]
      }
    }
  );
}

export async function handleAccentSelection(ctx: Context, accent: string) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  const user = (ctx as any).user;
  if (!user) return;

  const quizData = await storage.getBotSetting(`design_quiz_${user.id}`);
  const quiz = quizData ? JSON.parse(quizData) : {};
  quiz.accent = accent;
  
  await storage.setBotSetting(`design_quiz_${user.id}`, JSON.stringify(quiz));
  
  // Set agent state for photo upload
  await storage.setBotSetting(`agent_state_${user.id}`, JSON.stringify({ agent: 'designer' }));

  const accentNames: { [key: string]: string } = {
    lighting: 'Освещение',
    furniture: 'Мебель', 
    materials: 'Материалы'
  };

  ctx.reply(
    `✅ Акцент: ${accentNames[accent] || accent}\n\n` +
    '📸 Теперь загрузите фото комнаты для создания дизайн-проекта.\n\n' +
    'ИИ-Дизайнер учтёт ваши предпочтения и создаст персональную концепцию.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

export async function handleBuyRequests(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  ctx.reply(
    '💳 Выберите пакет дополнительных запросов:\n\n' +
    '📦 Доступные пакеты:\n' +
    '• +3 запроса — ₽299\n' +
    '• +10 запросов — ₽799\n\n' +
    'После покупки запросы добавятся к вашему лимиту.\n\n' +
    'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '+3 запроса - ₽299', callback_data: 'buy_requests_3' }],
          [{ text: '+10 запросов - ₽799', callback_data: 'buy_requests_10' }],
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

export async function handleRenovationIncludes(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  ctx.reply(
    '🔧 Что входит в ремонт под ключ:\n\n' +
    '▫️ Черновые работы: демонтаж, стяжка, штукатурка, электрика, сантехника\n' +
    '▫️ Инженерные системы: разводка коммуникаций по проекту\n' +
    '▫️ Отделка: финишные материалы, напольные покрытия, покраска\n' +
    '▫️ Мебель: подбор и установка по дизайн-проекту\n' +
    '▫️ Декор: текстиль, аксессуары, освещение\n\n' +
    'Всё — с одной командой и по единому договору.\n\n' +
    'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Как мы контролируем качество', callback_data: 'quality_control' }],
          [{ text: 'Консультация специалиста', callback_data: 'leave_request' }],
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

export async function handleQualityControl(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  ctx.reply(
    '🎯 Как мы контролируем качество:\n\n' +
    '▫️ Каждый этап сопровождает инженер-надзорщик\n' +
    '▫️ Вы видите фото- и видеоотчёты с объекта\n' +
    '▫️ Все расходы прозрачны — никаких доплат\n' +
    '▫️ Контроль соответствия проекту на всех этапах\n' +
    '▫️ Приёмка работ только после проверки качества\n\n' +
    'Результат — объект, который прослужит годами.\n\n' +
    'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
    {
      reply_markup: {
        inline_keyboard: [
          // [{ text: 'Что входит в ремонт', callback_data: 'renovation_includes' }],
          [{ text: 'Консультация специалиста', callback_data: 'leave_request' }],
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );
}

export async function handleConsultation(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  const user = (ctx as any).user;
  if (!user) return;

  ctx.reply(
    '👨‍🔧 Получить консультацию инженера\n\n' +
    'Наш инженер свяжется с вами для обсуждения найденных проблем и способов их решения.\n\n' +
    'Для записи на консультацию нам потребуется:\n' +
    '• Ваше имя\n' +
    '• Номер телефона\n' +
    '• Адрес объекта\n\n' +
    '👤 Как к вам обращаться?',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );

  // Set consultation form state
  await storage.setBotSetting(`consultation_form_${user.id}`, JSON.stringify({
    step: 'name',
    source: 'inspector_consultation'
  }));
}

export async function handleDiscussProject(ctx: Context) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  
  const user = (ctx as any).user;
  if (!user) return;

  ctx.reply(
    '🎨 Обсудить дизайн-проект\n\n' +
    'Наш дизайнер свяжется с вами для детального обсуждения концепции и воплощения идеи.\n\n' +
    'Для связи нам потребуется:\n' +
    '• Ваше имя\n' +
    '• Номер телефона\n' +
    '• Пожелания по проекту\n\n' +
    '👤 Как к вам обращаться?',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    }
  );

  // Set project discussion form state
  await storage.setBotSetting(`consultation_form_${user.id}`, JSON.stringify({
    step: 'name',
    source: 'designer_consultation'
  }));
}

import { createDefect } from "./storage";
import { listDefectsPaged } from "./storage";
import type { Telegraf } from 'telegraf';

// --- Фотофиксация дефектов ---

// server/botHandlers.ts

const draftKeyFor = (userId: number | string) => `defect_draft_${userId}`;

// Сброс мастеров (draft/after)
export async function handleDefReset(ctx: Context) {
  const uid = ctx.from!.id;
  await storage.setBotSetting(draftKeyFor(uid), "");
  await storage.setBotSetting(afterKeyFor(uid), "");
  await ctx.reply("✅ Мастер сброшен. Пришлите фото дефекта (можно несколько).");
}

export async function handleDefectStart(ctx: Context) {
  const user = ctx.from!;
  const uid = ctx.from!.id;
  await storage.setBotSetting(`defect_draft_${uid}`, JSON.stringify({ step: "photo" }));
  await storage.setBotSetting(afterKeyFor(uid), "");
  // В режиме фотофиксации ИИ-агента быть не должно
  await storage.setBotSetting(`agent_state_${uid}`, "");
  await ctx.reply("📸 Пришлите фото дефекта...");
}

export async function onDefectPhoto(ctx: Context, next: () => Promise<void>) {
  const userId = ctx.from!.id;
  const key = draftKeyFor(userId);

  const uid = ctx.from!.id;
  const agent = await storage.getBotSetting(`agent_state_${uid}`);
  if (agent) return next();

  // если мастер не активен — выходим сразу
  const exists = await storage.getBotSetting(key);
  if (!exists) return next();

  const msg: any = ctx.message;
  const photo = msg?.photo?.slice(-1)[0];
  if (!photo) return next();

  const mgid: string | undefined = msg.media_group_id;
  const fileId = photo.file_id;

  await runWithUserLock(userId, async () => {
    // ---- 1) Берём САМУЮ СВЕЖУЮ версию черновика и МЕРДЖИМ фото ----
    const freshRaw = await storage.getBotSetting(key);
    const draft = freshRaw ? JSON.parse(freshRaw) : { step: "photo" };

    draft.photos = Array.isArray(draft.photos) ? draft.photos : [];

    // дедуп по file_id
    if (!draft.photos.some((p: any) => p.telegramFileId === fileId)) {
      draft.photos.push({ telegramFileId: fileId, type: "initial" });
    }

    // отметим время последнего кадра (для дебаунса)
    draft._lastPhotoAt = Date.now();

    if (mgid) draft.pendingAlbum = String(mgid);

    // сохраняем обновлённый черновик
    await storage.setBotSetting(key, JSON.stringify(draft));

    // ---- 2) Дебаунс вопроса "Объект?" ----
    // a) Альбом: ждём 2500 мс тишины
    if (mgid) {
      const tk = `${userId}:${mgid}`;
      const prevT = albumTimers.get(tk);
      if (prevT) clearTimeout(prevT);

      const t = setTimeout(async () => {
        albumTimers.delete(tk);
        const latestRaw = await storage.getBotSetting(key);
        if (!latestRaw) return;
        const latest = JSON.parse(latestRaw);
        const quietFor = Date.now() - (latest._lastPhotoAt ?? 0);

        if (latest.step === "photo" && latest.lastAsked !== "object" && quietFor >= 2500) {
          latest.step = "object";
          latest.lastAsked = "object";
          await storage.setBotSetting(key, JSON.stringify(latest));
          await ctx.reply("🏗 Укажите объект (название стройки/проекта).");
        }
      }, 2500);

      albumTimers.set(tk, t);
      return;
    }

    // b) Пачка одиночных фото: каждый кадр откладывает вопрос на 1200 мс
    const prevS = singleTimers.get(userId);
    if (prevS) clearTimeout(prevS);

    const st = setTimeout(async () => {
      singleTimers.delete(userId);
      const latestRaw = await storage.getBotSetting(key);
      if (!latestRaw) return;
      const latest = JSON.parse(latestRaw);
      const quietFor = Date.now() - (latest._lastPhotoAt ?? 0);

      if (latest.step === "photo" && latest.lastAsked !== "object" && quietFor >= 1000) {
        latest.step = "object";
        latest.lastAsked = "object";
        await storage.setBotSetting(key, JSON.stringify(latest));
        await ctx.reply("🏗 Укажите объект (название стройки/проекта).");
      }
    }, 1200);

    singleTimers.set(userId, st);
  });
}


export async function onDefectText(ctx: Context) {
  const txt = (ctx.message as any)?.text as string | undefined;
  if (txt?.startsWith("/")) return; // не перехватываем команды
  const key = draftKeyFor(ctx.from!.id);
  const raw = await storage.getBotSetting(key);
  if (!raw) {
    await ctx.reply("Чтобы начать фиксацию дефекта, отправьте минимум 1 фото 📸");
    return;
  }

  const draft = JSON.parse(raw);
  const text = (ctx.message as any)?.text?.trim();
  if (!text) {
  try {
    const d = JSON.parse(raw);
    if (d.step === "object") {
      await ctx.reply("Пожалуйста, укажите объект. Пример: «ЖК Лесной, корпус 3»");
    } else if (d.step === "floor") {
      await ctx.reply("Пожалуйста, укажите этаж (число или секцию). Пример: «3» или «Секция B, 5»");
    } else if (d.step === "description") {
      await ctx.reply("Пожалуйста, коротко опишите проблему. Пример: «Трещина в штукатурке на откосе»");
    } else {
      await ctx.reply("Введите текст, пожалуйста 🙂");
    }
  } catch {
    await ctx.reply("Введите текст, пожалуйста 🙂");
  }
  return;}

  if (draft.step === "object") {
    draft.object = text;
    draft.step = "floor";
    await ctx.reply("Этаж?", { reply_markup: withEditButtons() as any });
  } else if (draft.step === "floor") {
    draft.floor = text;
    draft.step = "category";
    await ctx.reply("Выберите категорию:", {
      reply_markup: withEditButtons({
        inline_keyboard: [
          [{ text: "Архитектура",     callback_data: "def_cat:architecture" }],
          [{ text: "Конструктив",     callback_data: "def_cat:structural" }],
          [{ text: "Электрика",       callback_data: "def_cat:electrical" }],
          [{ text: "Сантехника",      callback_data: "def_cat:plumbing" }],
          [{ text: "Отделка",         callback_data: "def_cat:finishing" }],
          [{ text: "Благоустройство", callback_data: "def_cat:landscaping" }],
        ],
      }),
    });
  } else if (draft.step === "description") {
    draft.description = text;
    draft.step = "preview";
    await storage.setBotSetting(key, JSON.stringify(draft));
    await sendPreview(ctx, draft);
    return;
  }

  await storage.setBotSetting(key, JSON.stringify(draft));
}

export async function onDefCategory(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const key = draftKeyFor(ctx.from!.id);
  const raw = await storage.getBotSetting(key);
  if (!raw) return;

  const draft = JSON.parse(raw);
  const data = (ctx.callbackQuery as any).data as string;
  draft.category = data.split(":")[1];
  draft.step = "severity";
  await storage.setBotSetting(key, JSON.stringify(draft));
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply("Выберите критичность:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Критично",      callback_data: "def_sev:critical" }],
        [{ text: "Средне",        callback_data: "def_sev:medium" }],
        [{ text: "Незначительно", callback_data: "def_sev:low" }],
      ],
    },
  });
}

export async function onDefSeverity(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const key = draftKeyFor(ctx.from!.id);
  const raw = await storage.getBotSetting(key);
  if (!raw) return;

  const draft = JSON.parse(raw);
  const data = (ctx.callbackQuery as any).data as string;
  draft.severity = data.split(":")[1];
  draft.step = "description";
  await storage.setBotSetting(key, JSON.stringify(draft));
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply("Кратко опишите проблему (текстом).", { reply_markup: withEditButtons() as any });
}

// Блокировка на сохранение, чтобы не было дублей
const saveLocks = new Set<number>(); // по userId
const processedCb = new Set<string>(); // обработанные callbackQuery.id

export async function onDefSave(ctx: Context) {
  if (ctx.callbackQuery) {
    // 1) если этот callback уже обработан — выходим
    const cbid = (ctx.callbackQuery as any).id as string;
    if (processedCb.has(cbid)) {
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
    processedCb.add(cbid);
    await ctx.answerCbQuery().catch(() => {});
  }

  const uid = ctx.from!.id;

  // 2) если уже идёт сохранение у этого юзера — выходим
  if (saveLocks.has(uid)) return;
  saveLocks.add(uid);

  try {
    const k = draftKeyFor(uid);
    const raw = await storage.getBotSetting(k);
    if (!raw) return;

    const draft = JSON.parse(raw);

    const defect = await createDefect({
      object: draft.object,
      floor: draft.floor,
      category: draft.category,
      severity: draft.severity,
      description: draft.description,
      createdByUserId: String(uid),
      photos: draft.photos,
    });

    // очистка черновика и агента
    await storage.setBotSetting(k, "");
    await storage.setBotSetting(`agent_state_${uid}`, "");

    const photoCount = Array.isArray(draft.photos) ? draft.photos.length : 0;
    await ctx.reply(
      `✅ Дефект сохранён.\nID: #${defect.humanId}\nСтатус: ${defect.status}\nФото: ${photoCount} шт.`
    );
  } finally {
    saveLocks.delete(uid);
  }
}

export async function onDefCancel(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const uid = ctx.from!.id;
  await storage.setBotSetting(draftKeyFor(uid), "");
  await storage.setBotSetting(`agent_state_${uid}`, "");
  await ctx.reply("Отменено.");
}

// Форматирование предпросмотра карточки
function formatDraftPreview(draft: any): string {
  const obj   = (draft?.object ?? "").toString().trim() || "—";
  const floor = (draft?.floor ?? "").toString().trim() || "—";
  const cat   = (draft?.category ?? "").toString().trim() || "—";
  const sev   = (draft?.severity ?? "").toString().trim() || "—";
  const desc  = (draft?.description ?? "").toString().trim() || "—";
  const photos = Array.isArray(draft?.photos) ? draft.photos.length : 0;

  return (
    `📋 Предпросмотр:\n\n` +
    `Объект: ${obj}\n` +
    `Этаж: ${floor}\n` +
    `Категория: ${cat}\n` +
    `Критичность: ${sev}\n` +
    `Описание: ${desc}\n` +
    `Фото: ${photos} шт.`
  );
}

async function sendPreview(ctx: Context, draft: any) {
  try {
    const text =
      (typeof formatDraftPreview === "function"
        ? formatDraftPreview(draft)
        : `📋 Предпросмотр:\n\n` +
          `Объект: ${draft.object || "—"}\n` +
          `Этаж: ${draft.floor || "—"}\n` +
          `Категория: ${draft.category || "—"}\n` +
          `Критичность: ${draft.severity || "—"}\n` +
          `Описание: ${(draft.description || "—")}\n` +
          `Фото: ${(Array.isArray(draft.photos) ? draft.photos.length : 0)} шт.`) +
      "\n\nСохранить?";

    await ctx.reply(text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✏️ Редактировать карточку", callback_data: "def_edit_menu" }],
          [{ text: "✅ Сохранить", callback_data: "def_save" }],
          [{ text: "❌ Отмена",    callback_data: "def_cancel" }],
        ],
      },
    });

    // 👇 ДОБАВЛЕНО: отправляем фотографии черновика в предпросмотре
    const photosArr = Array.isArray(draft?.photos) ? draft.photos : [];
    if (photosArr.length > 0) {
      // Telegram разрешает до 10 фото в альбоме — шлём пачками по 10
      const MAX_MEDIA = 10;
      for (let i = 0; i < photosArr.length; i += MAX_MEDIA) {
        const chunk = photosArr.slice(i, i + MAX_MEDIA).map((p: any, idx: number) => {
          const media: any = {
            type: "photo",
            media: p.telegramFileId, // мы уже сохраняем file_id тут: { telegramFileId }
          };
          // Можно подписать только первый кадр первой пачки
          if (i === 0 && idx === 0) {
            media.caption = "📸 Фотофиксация (предпросмотр)";
          }
          return media;
        });

        try {
          await ctx.replyWithMediaGroup(chunk as any);
        } catch (e) {
          // не падаем из-за отдельных ошибок отправки медиа
          try { console.error("[sendPreview][mediaGroup]", e); } catch {}
        }
      }
    }

  } catch (err) {
    defReportError(ctx, "sendPreview", err);
  }
}



export async function showDefectCard(ctx: Context, humanIdRaw: string) {
  const humanId = humanIdRaw.toUpperCase().replace(/^#/, "");
  const data = await getDefectWithCountsByHumanId(humanId);  // ВАЖНО: расширенная
  if (!data) {
    await ctx.reply(`❌ Не нашёл ${humanId}. Проверьте номер.`);
    return;
  }
  const { defect: d, photos } = data;

  const text =
    `#${d.humanId} · ${d.status}\n\n` +
    `Объект: ${d.object ?? "—"}\n` +
    `Этаж: ${d.floor ?? "—"}\n` +
    `Категория/Критичность: ${d.category} / ${d.severity}\n` +
    `Фото: initial: ${photos.initial}, after: ${photos.after}\n`;

  const keyboard = {
    inline_keyboard: [
      // дальше оставь как было
      [{ text: "📎 Добавить «после»", callback_data: `def_after:${humanId}` }],
      [
        { text: "🕒 На контроль",  callback_data: `def_ctl_menu:${humanId}` },
        { text: "⬜️ Обнаружено",  callback_data: `def_status:discovered:${humanId}` },
      ],
      [{ text: "✅ Устранено", callback_data: `def_status:fixed:${humanId}` }],
    ],
  };

  await ctx.reply(text, { reply_markup: keyboard });
  return d;
}

// --- Мини-карточка для списков ---
function formatMiniCard(d: any) {
  const due = d.dueDate ? new Date(d.dueDate).toLocaleDateString("ru-RU") : "—";
  const statusEmoji =
    d.status === "on_control" ? "🕒" :
    d.status === "discovered" ? "🟡" :
    d.status === "fixed" ? "✅" : "•";

  return `${statusEmoji} #${d.humanId} · ${d.status}\n` +
         `Объект: ${d.object}\n` +
         (d.floor ? `Этаж: ${d.floor}\n` : "") +
         `Категория/Критичность: ${d.category} / ${d.severity}\n` +
         `Срок: ${due}`;
}

function miniCardKeyboard(humanId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Устранено", callback_data: `def_set_fixed:${humanId}` },
        { text: "+1 день",     callback_data: `def_due_p1:${humanId}` },
        { text: "+3 дня",      callback_data: `def_due_p3:${humanId}` },
      ],
      [
        { text: "🗓 Своя дата",      callback_data: `def_due_custom:${humanId}` },
        { text: "🧹 Снять с контроля", callback_data: `def_ctl_cancel:${humanId}` },
      ],
      [
        { text: "🔎 Открыть карточку", callback_data: `def_open:${humanId}` },
      ],
    ],
  } as const;
}

type MyListKind = "overdue" | "today" | "future" | "all" | "overdue_all";

export async function sendDefectsList(ctx: Context, kind: MyListKind, page = 0, assignee?: string) {
  const uid = assignee ?? String(ctx.from!.id);
  const PAGE = 5;
  const now = new Date();
  const todayEnd = new Date(); todayEnd.setHours(23,59,59,0);

  let opts: any = { assigneeId: uid, limit: PAGE, offset: page * PAGE, order: "due" };

  if (kind === "overdue") {
    opts.status = ["on_control"]; opts.dueBefore = now;
  } else if (kind === "today") {
    opts.status = ["on_control"]; opts.dueAfter = new Date(); opts.dueBefore = todayEnd;
  } else if (kind === "future") {
    opts.status = ["on_control"]; opts.dueAfter = new Date(todayEnd.getTime() + 1);
  } else if (kind === "all") {
    opts.status = ["on_control"];
  } else if (kind === "overdue_all") {
    opts = { limit: PAGE, offset: page * PAGE, order: "due", status: ["on_control"], dueBefore: now };
    delete opts.assigneeId;
  }

  const { rows, total } = await storage.listDefects(opts);

  const title =
    kind === "overdue" ? "⏰ Мои просроченные" :
    kind === "today"   ? "🟡 На сегодня" :
    kind === "future"  ? "🗓 На контроле (будущее)" :
    kind === "overdue_all" ? "⏰ Просроченные (все)" :
    "На контроле";

  if (rows.length === 0) {
    await ctx.reply(`${title}: пусто.`);
    return;
  }

  for (const d of rows) {
    await ctx.reply(formatMiniCard(d), { reply_markup: miniCardKeyboard(d.humanId) as any });
  }

  const pages = Math.ceil(total / PAGE);
  if (pages > 1) {
    const kb = {
      inline_keyboard: [[
        ...(page > 0 ? [{ text: "⬅️ Назад", callback_data: `list:${kind}:${page - 1}` }] : []),
        ...(page < pages - 1 ? [{ text: "Вперёд ➡️", callback_data: `list:${kind}:${page + 1}` }] : []),
      ]],
    } as const;
    await ctx.reply(`${title}: страница ${page + 1}/${pages}`, { reply_markup: kb as any });
  }
}

// --- Мастер «На контроль» ---
export async function controlMenu(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];
  const uid = ctx.from!.id;

  await storage.setBotSetting(controlKeyFor(uid), JSON.stringify({ humanId }));

  await ctx.reply(
    "Кто ответственный?",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "👤 Я",        callback_data: `def_assign_me:${humanId}` }],
          [{ text: "✍️ Указать…", callback_data: `def_assign_enter:${humanId}` }],
          [{ text: "❌ Отмена",   callback_data: `def_ctl_cancel:${humanId}` }],
        ],
      },
    }
  );
}

async function sendAllDefectPhotos(ctx: Context, defectId: string, humanId: string) {
  const photos = await getDefectPhotosAll(defectId);
  const before = photos.filter(p => p.type === "initial" || p.type === "before");
  const after  = photos.filter(p => p.type === "after");

  // «До»
  if (before.length) {
    await ctx.reply(`Фото «до» для #${humanId} (${before.length} шт.)`);
    for (const pack of chunk(before, 10)) {
      const media = pack.map((p, i) => ({
        type: "photo",
        media: p.telegramFileId,
        caption: i === 0 ? `#${humanId} · ДО (${before.length})` : undefined,
      })) as any[];
      await ctx.replyWithMediaGroup(media);
    }
  }

  // «После»
  if (after.length) {
    await ctx.reply(`Фото «после» для #${humanId} (${after.length} шт.)`);
    for (const pack of chunk(after, 10)) {
      const media = pack.map((p, i) => ({
        type: "photo",
        media: p.telegramFileId,
        caption: i === 0 ? `#${humanId} · ПОСЛЕ (${after.length})` : undefined,
      })) as any[];
      await ctx.replyWithMediaGroup(media);
    }
  }
}

/** Текст с #ID -> карточка */
export async function handleIdQueryText(ctx: Context) {
  const text = (ctx.message as any)?.text as string | undefined;
  if (!text) return;
  const m = text.match(RE_ID);
  if (!m) return;

  const humanId = m[1].toUpperCase();
  // показать карточку
  const defect = await showDefectCard(ctx, humanId); // вывод карточки и получаем объект
  const defectId = (defect as any)?.id; // id берём из возвращённого объекта

  if (defectId) {
    await sendAllDefectPhotos(ctx, defectId, humanId);
  } else {
    await ctx.reply("Не удалось найти фотографии для этого дефекта.");
  }

  // опционально: включать режим «после» как раньше — если нужно, оставь:
  // await storage.setBotSetting(afterKeyFor(ctx.from!.id), JSON.stringify({ humanId }));
}

const afterKeyFor = (uid: number | string) => `after_draft_${uid}`;

export async function startAddAfter(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];
  await storage.setBotSetting(afterKeyFor(ctx.from!.id), JSON.stringify({ humanId }));
  await ctx.reply(`Ок. Отправьте одно или несколько фото «после» для #${humanId}.`);
}

/** Приём фото "после" (сохраняем сразу в БД) */
export async function onAfterPhoto(ctx: Context, next: () => Promise<void>) {
  const uid = ctx.from!.id;
  const key = afterKeyFor(uid);
  const raw = await storage.getBotSetting(key);

  const user = ctx.from!;
  // сбрасываем ИИ-режим, чтобы фото пошло в мастер
  await storage.setBotSetting(`agent_state_${user.id}`, "");

  const agent = await storage.getBotSetting(`agent_state_${uid}`);
  if (agent) return next();

  // если режим "после" не включен — пропускаем фото дальше (к мастеру initial)
  if (!raw) return next();

  const { humanId } = JSON.parse(raw) as { humanId: string };
  const msg: any = ctx.message;
  const photo = msg?.photo?.slice(-1)[0];
  if (!photo) return next();

  const defect = await getDefectByHumanId(humanId);
  if (!defect) {
    await ctx.reply(`❌ Не нашёл #${humanId}. Отменяю.`);
    await storage.setBotSetting(key, "");
    return;                 // обработали — дальше не идём
  }

  await addDefectPhotosBulk({
    defectId: defect.id,
    type: "after",
    telegramFileIds: [photo.file_id],
    createdByUserId: String(uid),
  });

  await ctx.reply(`📎 Добавил 1 фото «после» к #${humanId}. Можно отправить ещё или нажать «✅ Устранено».`);
  // обработали — дальше не идём
}

export async function setStatusControl(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];
  const res = await updateDefectStatusByHumanId({ humanId, to: "on_control", actorUserId: String(ctx.from!.id) });
  if (!res.ok) return ctx.reply(`❌ Не удалось поменять статус (${res.reason}).`);
  await ctx.reply(`🕒 #${humanId} теперь «На контроле».`);
  await showDefectCard(ctx, humanId);
}

export async function setStatusDiscovered(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];
  const res = await updateDefectStatusByHumanId({ humanId, to: "discovered", actorUserId: String(ctx.from!.id) });
  if (!res.ok) return ctx.reply(`❌ Не удалось поменять статус (${res.reason}).`);
  await ctx.reply(`↩️ #${humanId} возвращён в «Обнаружено».`);
  await showDefectCard(ctx, humanId);
}

// Обработчик кнопки "✅ Устранено"
export async function setStatusFixed(ctx: Context) {
  // отвечаем на callback, чтобы не висели "часики"
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

  // из callback_data вида "def_set_fixed:D-000123" достаём humanId
  const humanId = (ctx.callbackQuery as any)?.data.split(":")[1];
  if (!humanId) return;

  const uid = ctx.from!.id;
  const afterKey = afterKeyFor(uid);

  // Проверим, есть ли активный режим добавления "после".
  // Если режима нет — включим его и попросим прислать фото.
  const afterRaw = await storage.getBotSetting(afterKey);
  if (!afterRaw) {
    await storage.setBotSetting(afterKey, JSON.stringify({ humanId }));
    await ctx.reply("📷 Отправьте фото «после» (можно несколько). Затем снова нажмите «✅ Устранено».");
    return;
  } else {
    // Если режим есть, но к другому дефекту — переключим на текущий
    const st = JSON.parse(afterRaw) as { humanId?: string; count?: number };
    if (st.humanId !== humanId) {
      await storage.setBotSetting(afterKey, JSON.stringify({ humanId }));
      await ctx.reply("📷 Отправьте фото «после» (можно несколько) и снова нажмите «✅ Устранено».");
      return;
    }
  }

  // Меняем статус на fixed, требуя хотя бы одно фото "после"
  const res = await updateDefectStatusByHumanId({
    humanId,
    to: "fixed",
    actorUserId: String(uid),
    requireAfter: true,
  });

  if (res.ok) {
    // ✅ Правка: после успешного закрытия очищаем режим "after"
    await storage.setBotSetting(afterKey, ""); // ← сбрасываем режим after

    await ctx.reply(`✅ #${humanId}: статус «Устранено».`);
    await showDefectCard(ctx, humanId);
    return;
  }

  // Если не получилось закрыть — покажем причину
  await ctx.reply(`❌ Не удалось закрыть #${humanId}: ${res.reason ?? "неизвестная ошибка"}.`);
}


export async function handleFixByCaption(
  ctx: Context,
  next: () => Promise<void>
) {
  const uid = ctx.from!.id;
  const user = ctx.from!;

  await storage.setBotSetting(`agent_state_${user.id}`, "");
  const agent = await storage.getBotSetting(`agent_state_${uid}`);
  if (agent) return next();

  const caption = (ctx.message as any)?.caption as string | undefined;
  if (!caption) return next();                        // пропускаем дальше

  // не мешаем, если включён мастер или режим after
  const draft = await storage.getBotSetting(draftKeyFor(uid));
  const after = await storage.getBotSetting(afterKeyFor(uid));
  if (draft || after) return next();

  const m = caption.match(RE_FIXED_CAPTION);
  if (!m) return next();

  const humanId = m[2].toUpperCase();

  const msg: any = ctx.message;
  const photo = msg?.photo?.slice(-1)[0];
  if (!photo) return next();

  const defect = await getDefectByHumanId(humanId);
  if (!defect) {
    await ctx.reply(`❌ Не нашёл ${humanId}.`);
    return;                                           // обработали — дальше не идём
  }

  await addDefectPhotosBulk({
    defectId: defect.id,
    type: "after",
    telegramFileIds: [photo.file_id],
    createdByUserId: String(uid),
  });

  const res = await updateDefectStatusByHumanId({
    humanId,
    to: "fixed",
    actorUserId: String(uid),
    requireAfter: true,
  });

  if (!res.ok) {
    await ctx.reply(`❌ Не удалось закрыть ${humanId} (${res.reason}).`);
    return;
  }

  await ctx.reply(`✅ ${humanId}: фото «после» добавлено, статус «Устранено».`);
  // здесь next() уже не вызываем
}

export async function startControlWizard(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];

  // сохраним состояние мастера
  const uid = ctx.from!.id;
  const state = { humanId, step: "ask_assignee" as const };
  await storage.setBotSetting(controlKeyFor(uid), JSON.stringify(state));

  await ctx.reply(
    `Кого назначить ответственным за #${humanId}?\n` +
    `Выберите вариант или отправьте @username / Telegram ID числом.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "👤 Я", callback_data: `def_ctl_me:${humanId}` }],
          [{ text: "✍️ Ввести вручную", callback_data: `def_ctl_enter:${humanId}` }],
          [{ text: "❌ Отмена", callback_data: `def_ctl_cancel:${humanId}` }],
        ],
      },
    }
  );
}

export async function controlAssignMe(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];
  const uid = ctx.from!.id;

  const state = { humanId, step: "ask_due" as const, assignedTo: String(uid) };
  await storage.setBotSetting(controlKeyFor(uid), JSON.stringify(state));

  await askDue(ctx, humanId);
}

export async function controlAssignEnter(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];
  const uid = ctx.from!.id;

  const state = { humanId, step: "wait_assignee_input" as const };
  await storage.setBotSetting(controlKeyFor(uid), JSON.stringify(state));

  await ctx.reply("Ок. Пришлите @username или Telegram ID числом.");
}

export async function controlAssignCancel(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const uid = ctx.from!.id;
  await storage.setBotSetting(controlKeyFor(uid), "");
  await ctx.reply("Отменено.");
}

export async function onControlWizardText(ctx: Context, next: () => Promise<void>) {
  const uid = ctx.from!.id;
  const key = controlKeyFor(uid);
  const raw = await storage.getBotSetting(key);
  if (!raw) return next();

  const state = JSON.parse(raw);
  const text = (ctx.message as any)?.text?.trim();

  if (state.step === "wait_assignee_input") {
    if (!text) return;

    // простая валидация
    const assignedTo = text.startsWith("@") ? text : /^\d+$/.test(text) ? text : null;
    if (!assignedTo) {
      await ctx.reply("Нужно прислать @username или числовой Telegram ID.");
      return;
    }

    state.assignedTo = assignedTo;
    state.step = "ask_due";
    await storage.setBotSetting(key, JSON.stringify(state));

    await askDue(ctx, state.humanId);
    return;
  }

  if (state.step === "wait_due_input") {
  const m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) {
    await ctx.reply("Формат даты: ДД.ММ.ГГГГ, например 28.09.2025");
    return;
  }
  const [_, dd, mm, yyyy] = m;
  // 23:59:59 локального → далее в ISO (UTC)
  const dt = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 23, 59, 59, 0);
  await finalizeControl(ctx, dt.toISOString());
  return;
  }


  // если это не наш шаг — пропускаем дальше
  return next();
}

export async function controlDueToday(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await finalizeControl(ctx, toISODateLocal(0));
}

export async function controlDuePlus1(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await finalizeControl(ctx, toISODateLocal(1));
}

export async function controlDuePlus3(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await finalizeControl(ctx, toISODateLocal(3));
}

export async function controlDueCustom(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];
  const uid = ctx.from!.id;
  const key = controlKeyFor(uid);
  const raw = await storage.getBotSetting(key);
  if (!raw) return;

  const state = JSON.parse(raw);
  state.step = "wait_due_input";
  await storage.setBotSetting(key, JSON.stringify(state));

  await ctx.reply("Пришлите дату в формате ДД.ММ.ГГГГ (например, 28.09.2025).");
}

async function finalizeControl(ctx: Context, dueISO: string) {
  const uid = ctx.from!.id;
  const key = controlKeyFor(uid);
  const raw = await storage.getBotSetting(key);
  if (!raw) return;
  const state = JSON.parse(raw) as { humanId: string; assignedTo?: string };

  if (!state.assignedTo) {
    await ctx.reply("Не указан ответственный. Начните заново.");
    await storage.setBotSetting(key, "");
    return;
  }

  const humanId = state.humanId;
  const actor = String(uid);

  // 1) назначить
  const a = await assignDefectByHumanId(humanId, state.assignedTo, actor);
  if (!a.ok) {
    await ctx.reply(`❌ Не удалось назначить (${a.reason}).`);
    return;
  }

  // 2) срок
  const s = await setDefectDueDateByHumanId(humanId, dueISO, actor);
  if (!s.ok) {
    await ctx.reply(`❌ Не удалось сохранить срок (${s.reason}).`);
    return;
  }

  // 3) статус: на контроле
  const u = await updateDefectStatusByHumanId({
    humanId,
    to: "on_control",
    actorUserId: actor,
  });
  if (!u.ok) {
    await ctx.reply(`⚠️ Назначение и срок сохранены, но не удалось сменить статус (${u.reason}).`);
  }

  await storage.setBotSetting(key, ""); // очистка мастера

  // 4) уведомления
  const defect = await getDefectByHumanId(humanId);
  const assignee = state.assignedTo;
  const dueDate = new Date(dueISO);
  const dueStr = dueDate.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

  await ctx.reply(
    `🕒 #${humanId} взят на контроль.\n` +
    `Ответственный: ${assignee}\n` +
    `Срок: ${dueStr}`
  );

  // DM ответственному, если это числовой TG ID
  if (/^\d+$/.test(assignee)) {
    try {
      await ctx.telegram.sendMessage(
        Number(assignee),
        `Вам назначен дефект #${humanId}. Срок: ${dueStr}`
      );
    } catch {}
  }

  // Уведомить автора дефекта (если известен)
  if (defect?.createdByUserId && defect.createdByUserId !== actor) {
    try {
      await ctx.telegram.sendMessage(
        Number(defect.createdByUserId),
        `Ваш дефект #${humanId} взят на контроль. Ответственный: ${assignee}, срок: ${dueStr}`
      );
    } catch {}
  }

  // Перерисовать карточку
  await showDefectCard(ctx, humanId);
}

// ... здесь твои хелперы: formatMiniCard, miniCardKeyboard, sendDefectsList, showDefectCard

export function registerListCommands(bot: Telegraf<Context>) {
  // открыть карточку
  bot.action(/def_open:(.+)/, async (ctx) => {
    const humanId = (ctx.callbackQuery as any).data.split(":")[1];
    await ctx.answerCbQuery().catch(()=>{});
    await showDefectCard(ctx, humanId);
  });

  // пагинация
  bot.action(/list:(.+):(\d+)/, async (ctx) => {
    const [, kindRaw, pageRaw] = ((ctx.callbackQuery as any).data as string).match(/list:(.+):(\d+)/)!;
    await ctx.answerCbQuery().catch(()=>{});
    await sendDefectsList(ctx, kindRaw as any, Number(pageRaw));
  });

  // /my [today|overdue|future|all]
  bot.command("my", async (ctx) => {
    console.log("MY CMD from", ctx.from?.id, "text=", (ctx.message as any).text);
    const arg = (ctx.message as any).text.split(" ").slice(1).join(" ").trim().toLowerCase();
    const kind = (arg === "today" ? "today" :
                  arg === "overdue" ? "overdue" :
                  arg === "future" ? "future" : "all") as any;
    await sendDefectsList(ctx, kind, 0);
  });

  // алиасы на всякий случай
  bot.command("my_today",   async (ctx) => sendDefectsList(ctx, "today", 0));
  bot.command("my_overdue", async (ctx) => sendDefectsList(ctx, "overdue", 0));
  bot.command("my_future",  async (ctx) => sendDefectsList(ctx, "future", 0));

  bot.command("overdue",    async (ctx) => sendDefectsList(ctx, "overdue_all", 0));
  bot.command("oncontrol",  async (ctx) => sendDefectsList(ctx, "future", 0));

  console.log("✅ list commands registered");
}

export async function handleListsMenu(ctx: Context) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

  const kb = {
    inline_keyboard: [
      // Мои
      [{ text: "👤 Мои — сегодня",       callback_data: "list:today:0" }],
      [
        { text: "👤 Мои — просрочены",   callback_data: "list:overdue:0" },
        { text: "👤 Мои — на контроле",  callback_data: "list:future:0" },
      ],
      [{ text: "👤 Мои — все",           callback_data: "list:all:0" }],

      // Все
      [
        { text: "🗂 Все — просрочены",   callback_data: "list:overdue_all:0" },
        { text: "🗂 Все — на контроле",  callback_data: "list:future:0" },
      ],

      [{ text: "🏠 Главное меню",        callback_data: "start" }],
    ],
  } as const;

  await ctx.reply("Выберите список задач:", { reply_markup: kb as any });
}

// --- A2 helpers: edit buttons ---
function editButtonsInline() {
  return [
    [
      { text: "🧱 Изменить объект", callback_data: "def_edit:object" },
      { text: "↕️ Изменить этаж",  callback_data: "def_edit:floor"  },
    ]
  ];
}

// Вмержить кнопки редактирования в любое inline-меню
function withEditButtons(kb?: any) {
  const base = kb?.inline_keyboard ? kb.inline_keyboard : (Array.isArray(kb) ? kb : []);
  return { inline_keyboard: [...base, ...editButtonsInline()] };
}

export async function onDefEdit(ctx: Context) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from!.id;
    const key = `defect_draft_${uid}`;

    const raw = await storage.getBotSetting(key);
    if (!raw) { await ctx.reply("Сначала начните мастер: пришлите фото дефекта 📸"); return; }

    const draft = JSON.parse(raw);
    const data = (ctx.callbackQuery as any)?.data as string;
    const target = data?.split(":")[1];

    if (target === "object") {
      draft.step = "object";
      await storage.setBotSetting(key, JSON.stringify(draft));
      await ctx.reply("🧱 Введите новый объект:");
    } else if (target === "floor") {
      draft.step = "floor";
      await storage.setBotSetting(key, JSON.stringify(draft));
      await ctx.reply("↕️ Введите новый этаж:");
    } else if (target === "description") {
      draft.step = "description";
      await storage.setBotSetting(key, JSON.stringify(draft));
      await ctx.reply("📝 Введите новое описание:");
    } else if (target === "photos") {
      draft.step = "photo";
      await storage.setBotSetting(key, JSON.stringify(draft));
      await ctx.reply(
        "📷 Пришлите дополнительные фото (можно несколько). Если хотите начать заново с фото — нажмите «Очистить фото».",
        { reply_markup: { inline_keyboard: [[{ text: "🗑 Очистить фото", callback_data: "def_photos_clear" }]] } }
      );
    } else {
      await ctx.reply("Что вы хотите изменить: объект, этаж, описание или фото?");
    }
  } catch (err) {
    defReportError(ctx, "onDefEdit", err);
  }
}

// Меню редактирования полей черновика
export async function onDefEditMenu(ctx: Context) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from!.id;
    const key = `defect_draft_${uid}`;

    const raw = await storage.getBotSetting(key);
    if (!raw) {
      await ctx.reply("Сначала начните мастер: пришлите фото дефекта 📸");
      return;
    }

    await ctx.reply("Что хотите отредактировать?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🧱 Объект",   callback_data: "def_edit:object" },
            { text: "↕️ Этаж",     callback_data: "def_edit:floor"  },
          ],
          [{ text: "📝 Описание", callback_data: "def_edit:description" }],
          [{ text: "📷 Фото",     callback_data: "def_edit:photos" }],
          [{ text: "◀️ Назад к предпросмотру", callback_data: "def_preview_back" }],
        ],
      },
    });
  } catch (err) {
    defReportError(ctx, "onDefEditMenu", err);
  }
}


// Очистить массив фото в черновике
export async function onDefPhotosClear(ctx: Context) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from!.id;
    const key = `defect_draft_${uid}`;
    const raw = await storage.getBotSetting(key);
    if (!raw) { await ctx.reply("Черновик не найден. Пришлите фото, чтобы начать."); return; }

    const draft = JSON.parse(raw);
    draft.photos = [];
    draft.step = "photo";
    await storage.setBotSetting(key, JSON.stringify(draft));
    await ctx.reply("🧹 Фото очищены. Пришлите новые фото дефекта 📸");
  } catch (err) {
    defReportError(ctx, "onDefPhotosClear", err);
  }
}

// Вернуться к предпросмотру текущего черновика
export async function onDefPreviewBack(ctx: Context) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from?.id;
    if (!uid) return;
    const key = `defect_draft_${uid}`;
    const raw = await storage.getBotSetting(key);
    if (!raw) { await ctx.reply("Черновик не найден. Пришлите фото, чтобы начать."); return; }

    const draft = JSON.parse(raw);
    await sendPreview(ctx, draft);
  } catch (err) {
    defReportError(ctx, "onDefPreviewBack", err);
  }
}

// Меню: что редактировать в существующей карточке
export async function onDefCardEditMenu(ctx: Context) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const data = (ctx.callbackQuery as any).data as string; // def_edit_def:D-000123
    const humanId = data.split(":")[1];

    (ctx as any)._editingDefectId = humanId; // на всякий
    await storage.setBotSetting(`def_edit_meta_${ctx.from!.id}`, JSON.stringify({ humanId }));

    await ctx.reply(`Что хотите отредактировать в #${humanId}?`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🧱 Объект",   callback_data: `def_edit_field:object:${humanId}` },
            { text: "↕️ Этаж",     callback_data: `def_edit_field:floor:${humanId}`  },
          ],
          [{ text: "📝 Описание", callback_data: `def_edit_field:description:${humanId}` }],
        ],
      },
    });
  } catch (err) {
    // не привязываемся к сторонним логгерам
    try { console.error("[def-card-edit][menu]", err); } catch {}
  }
}

// Выбор поля: просим ввести новое значение
export async function onDefCardEditField(ctx: Context) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const data = (ctx.callbackQuery as any).data as string; // def_edit_field:<field>:<ID>
    const parts = data.split(":"); // ["def_edit_field", "<field>", "<ID>"]
    const field = parts[1] as "object" | "floor" | "description";
    const humanId = parts[2];

    await storage.setBotSetting(`def_edit_wait_${ctx.from!.id}`, JSON.stringify({ humanId, field }));

    const prompt =
      field === "object" ? "🧱 Введите новый объект:" :
      field === "floor"  ? "↕️ Введите новый этаж:" :
                           "📝 Введите новое описание:";

    await ctx.reply(prompt);
  } catch (err) {
    try { console.error("[def-card-edit][field]", err); } catch {}
  }
}

// Пришёл текст для выбранного поля — обновляем карточку и показываем её заново
export async function onDefCardEditText(ctx: Context, next: () => Promise<void>) {
  try {
    const msg: any = ctx.message;
    const text = msg?.text?.trim();
    if (!text) return next(); // пропускаем не-текст

    const uid = ctx.from!.id;
    const raw = await storage.getBotSetting(`def_edit_wait_${uid}`);
    if (!raw) return next(); // не ждём ввода — пусть другие хендлеры обработают

    // Сбросим "режим ожидания" заранее, чтобы не подвисать
    await storage.setBotSetting(`def_edit_wait_${uid}`, "");

    const { humanId, field } = JSON.parse(raw) as { humanId: string; field: "object"|"floor"|"description" };

    // ⚠️ ВАЖНО: здесь нужен апдейт в БД. Если в твоём storage уже есть подходящий метод — используй его.
    // Ниже — универсальный пример; замени на свой вызов:
    //   await updateDefectMetaByHumanId({ humanId, patch: { [field]: text }, actorUserId: String(uid) });
    //
    // Если у тебя нет такого метода — временно добавь тонкий адаптер в storage, либо поменяй имя на существующее.

    if (typeof (storage as any).updateDefectMetaByHumanId === "function") {
      await (storage as any).updateDefectMetaByHumanId({ humanId, patch: { [field]: text }, actorUserId: String(uid) });
    } else if (typeof (storage as any).updateDefectFieldByHumanId === "function") {
      await (storage as any).updateDefectFieldByHumanId({ humanId, field, value: text, actorUserId: String(uid) });
    } else {
      // fallback: скажем пользователю, если метода нет
      await ctx.reply("Редактирование пока не подключено к БД. Добавьте в storage метод updateDefectMetaByHumanId(...) или updateDefectFieldByHumanId(...).");
      return;
    }

    await ctx.reply("✅ Обновлено.");
    // Показать карточку заново
    await showDefectCard(ctx, humanId);
  } catch (err) {
    try { console.error("[def-card-edit][text]", err); } catch {}
  }
}

export async function handleLeadFormText(ctx: Context, next: () => Promise<void>) {
  if (!ctx.from || !("message" in ctx) || !(ctx as any).message?.text) return next();
  const text = (ctx as any).message.text.trim();
  if (text.startsWith("/")) return next();

  const userId = ctx.from.id;
  const state = await getFlowState(userId);
  if (!state) return next();

  // имя → телефон
  if (state === "lead:name") {
    await setLeadData(userId, { name: text });
    await setFlowState(userId, "lead:phone");
    await (ctx as any).reply("📞 Укажите номер телефона (например, +7 999 123-45-67):");
    return;
  }

  // телефон → Шаг 1 (тип объекта)
  if (state === "lead:phone") {
    const phone = validateAndNormalizeRuPhone(text);
    if (!phone) {
      await (ctx as any).reply(
        "Пожалуйста, укажите телефон в одном из форматов:\n" +
        "• +79XXXXXXXXX (например, +79991234567)\n" +
        "• 89XXXXXXXXX (например, 89991234567)"
      );
      return;
    }

    const data = await getLeadData(userId);
    data.phone = phone; // уже нормализовано в +79...
    await setLeadData(userId, data);

    await setFlowState(userId, "quiz:kind");
    await (ctx as any).reply("🏢 Шаг 1. Тип объекта:", kbKind());
    return;
  }

  // адрес (свободный ввод) → Шаг 5.2 (тип помещения)
  if (state === "quiz:address") {
    const v = text.slice(0, 200);
    const data = await getLeadData(userId);
    data.property = data.property || {};
    data.property.address = v;
    await setLeadData(userId, data);

    await setFlowState(userId, "quiz:space_type");
    await (ctx as any).reply("🏷️ Уточните тип помещения:", kbSpaceType());
    return;
  }

  // точная площадь (свободный ввод, число)
  if (state === "quiz:area_exact") {
    const n = normalizeArea(text);
    if (n == null) {
      await (ctx as any).reply("Введите площадь числом (1–2000 м²). Пример: 86.5");
      return;
    }
    const data = await getLeadData(userId);
    data.property = data.property || {};
    data.property.area_exact = n;
    await setLeadData(userId, data);

    // завершение — письмо
    await clearFlowState(userId);
    await clearLeadData(userId);
    await (ctx as any).reply("✅ Спасибо! Заявка отправлена. Мы свяжемся с вами.");

    await sendLeadEmail({
        tgId: ctx.from!.id,
        username: ctx.from!.username,
        name: data.name,
        phone: data.phone,
        // опционально: если хочешь оставить короткий комментарий пользователя – можешь положить сюда
        message: undefined,
        source: "telegram-consultation",
        quiz: {
          property: {
            kind: data.property?.kind,           // 'new_flat' | 'old_flat' | 'house' | 'commercial'
            area_band: data.property?.area_band, // 'lt50' | '50_100' | 'gt100'
            address: data.property?.address,     // строка адреса
            space_type: data.property?.space_type, // 'apartment' | 'office' | 'retail' | 'shop' | 'other'
            area_exact: data.property?.area_exact as number | undefined, // число
          },
          design_project: data.design_project,     // 'have' | 'none' | 'need'
          renovation: { type: data.renovation?.type }, // 'rough' | 'cosmetic' | 'designer' | 'capital'
        },
    });

    return;
  }

  // на любой другой state — перестраховочный сброс
  await clearFlowState(userId);
  await clearLeadData(userId);
  await (ctx as any).reply("Давайте начнём сначала: нажмите «Оставить заявку» ещё раз 🙌");
}

// Шаг 1: тип объекта
export async function onQuizKind(ctx: Context) {
  const userId = ctx.from!.id;
  const kind = (ctx as any).match?.[1]; // new_flat | old_flat | house | commercial
  const data = await getLeadData(userId);
  data.property = data.property || {};
  data.property.kind = kind;
  await setLeadData(userId, data);

  await setFlowState(userId, "quiz:area_band");
  await (ctx as any).answerCbQuery();
  await (ctx as any).editMessageReplyMarkup(); // убрать старые кнопки
  await (ctx as any).reply("📐 Шаг 2. Площадь:", kbAreaBand());
}

// Шаг 2: диапазон площади
export async function onQuizAreaBand(ctx: Context) {
  const userId = ctx.from!.id;
  const band = (ctx as any).match?.[1]; // lt50 | 50_100 | gt100
  const data = await getLeadData(userId);
  data.property = data.property || {};
  data.property.area_band = band;
  await setLeadData(userId, data);

  await setFlowState(userId, "quiz:design");
  await (ctx as any).answerCbQuery();
  await (ctx as any).editMessageReplyMarkup();
  await (ctx as any).reply("🧩 Шаг 3. Дизайн-проект:", kbDesign());
}

// Шаг 3: дизайн-проект
export async function onQuizDesign(ctx: Context) {
  const userId = ctx.from!.id;
  const design = (ctx as any).match?.[1]; // have | none | need
  const data = await getLeadData(userId);
  data.design_project = design;
  await setLeadData(userId, data);

  await setFlowState(userId, "quiz:renovation_type");
  await (ctx as any).answerCbQuery();
  await (ctx as any).editMessageReplyMarkup();
  await (ctx as any).reply("🔧 Шаг 4. Тип ремонта:", kbRenovation());
}

// Шаг 4: тип ремонта
export async function onQuizRenovationType(ctx: Context) {
  const userId = ctx.from!.id;
  const rtype = (ctx as any).match?.[1]; // rough | cosmetic | designer | capital
  const data = await getLeadData(userId);
  data.renovation = data.renovation || {};
  data.renovation.type = rtype;
  await setLeadData(userId, data);

  await setFlowState(userId, "quiz:address");
  await (ctx as any).answerCbQuery();
  await (ctx as any).editMessageReplyMarkup();
  await (ctx as any).reply("📍 Шаг 5.1 — Укажите адрес (улица, дом, корпус, квартира, торговое помещение, офис, магазин):");
}

// Шаг 5.2: тип помещения
export async function onQuizSpaceType(ctx: Context) {
  const userId = ctx.from!.id;
  const space = (ctx as any).match?.[1]; // apartment | office | retail | shop | other
  const data = await getLeadData(userId);
  data.property = data.property || {};
  data.property.space_type = space;
  await setLeadData(userId, data);

  await setFlowState(userId, "quiz:area_exact");
  await (ctx as any).answerCbQuery();
  await (ctx as any).editMessageReplyMarkup();
  await (ctx as any).reply("📏 Введите точную площадь (число, м²):");
}


const kbKind = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Квартира (новостройка)", "q_kind:new_flat")],
    [Markup.button.callback("Квартира (вторичка)", "q_kind:old_flat")],
    [Markup.button.callback("Дом / коттедж", "q_kind:house")],
    [Markup.button.callback("Коммерческий объект", "q_kind:commercial")],
  ]);

const kbAreaBand = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("до 50 м²", "q_area:lt50")],
    [Markup.button.callback("50–100 м²", "q_area:50_100")],
    [Markup.button.callback("100+ м²", "q_area:gt100")],
  ]);

const kbDesign = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Есть", "q_design:have")],
    [Markup.button.callback("Нет", "q_design:none")],
    [Markup.button.callback("Нужен", "q_design:need")],
  ]);

const kbRenovation = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Черновой", "q_rtype:rough")],
    [Markup.button.callback("Косметический", "q_rtype:cosmetic")],
    [Markup.button.callback("Дизайнерский", "q_rtype:designer")],
    [Markup.button.callback("Капитальный", "q_rtype:capital")],
  ]);

const kbSpaceType = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("квартира", "q_space:apartment")],
    [Markup.button.callback("офис", "q_space:office")],
    [Markup.button.callback("торговое помещение", "q_space:retail")],
    [Markup.button.callback("магазин", "q_space:shop")],
    [Markup.button.callback("другое", "q_space:other")],
  ]);

function normalizeArea(s: string): number | null {
  const n = Number(String(s).replace(",", ".").replace(/[^\d.]/g, ""));
  if (!isFinite(n)) return null;
  if (n < 1 || n > 2000) return null;
  return Math.round(n * 100) / 100;
}