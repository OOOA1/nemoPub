import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { storage } from './storage';
import { 
  handleStart, 
  handleInspector, 
  handleDesigner, 
  handleRenovation, 
  handleHowWeWork, 
  handleLeaveRequest, 
  handleReferral,
  handleSubscriptionCheck,
  handleBuyRequests,
  handleLimitsCheck,
  handleStyleSelection,
  handlePrioritySelection,
  handleAccentSelection,
  handleRenovationIncludes,
  handleQualityControl,
  handleConsultation,
  handleDiscussProject
} from './botHandlers';
import { onDefEditMenu, onDefEdit, onDefPhotosClear, onDefPreviewBack } from './botHandlers';
import { clearAfterMode, getAfterMode } from "./afterMode";
import { 
  createInvoice, 
  handlePreCheckoutQuery, 
  handleSuccessfulPayment,
  getPaymentKeyboard
} from './payments';
import { 
  analyzeConstructionImage, 
  generateDesignConcept, 
  formatInspectionReport, 
  formatDesignReport 
} from './openai';
import { updateUserSubscriptionStatus } from './subscriptionChecker';
import { 
  handleIdQueryText,
  startAddAfter,
  onAfterPhoto,
  setStatusControl,
  setStatusDiscovered,
  setStatusFixed,
  handleFixByCaption,
} from "./botHandlers";
import { onDefCardEditMenu, onDefCardEditField, onDefCardEditText } from './botHandlers';
import {
  startControlWizard,
  controlAssignMe,
  controlAssignEnter,
  controlAssignCancel,
  onControlWizardText,
  controlDueToday,
  controlDuePlus1,
  controlDuePlus3,
  controlDueCustom,
  handleListsMenu,
  sendDefectsList, 
} from "./botHandlers";
import { handleDefReset, controlMenu, controlKeyFor, askDue, showDefectCard, registerListCommands } from "./botHandlers";
import { ensureUser } from "./middlewares/ensureUser";
import { registerRoleCommands } from "./roleHandlers";

// + импортируй из botHandlers то, чем пользуешься
import { /* ... */ } from "./botHandlers";

// Import settings getter to avoid circular dependency
import { getCurrentAISettings } from './aiSettings';
import { generateReportPDF, generateReportExcel } from './reports';

// Two-bot system:
// PREVIEW (Replit Workspace): BOT_TOKEN_DEV - новый бот для превью
// DEPLOY (Replit Deploy): BOT_TOKEN - существующий бот для деплоя

const isDeployment = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';

// Включаем Preview - токены разные, конфликта нет  
const DISABLE_PREVIEW_BOT = false;

let botToken: string;

console.log('🔍 Environment debug info:');
console.log(`  - REPLIT_DEPLOYMENT: ${process.env.REPLIT_DEPLOYMENT}`);
console.log(`  - NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`  - isDeployment: ${isDeployment}`);
console.log(`  - BOT_TOKEN available: ${!!process.env.BOT_TOKEN}`);
console.log(`  - BOT_TOKEN_DEV available: ${!!process.env.BOT_TOKEN_DEV}`);
console.log(`  - BOT_TOKEN_PREVIEW available: ${!!process.env.BOT_TOKEN_PREVIEW}`);

// ОЧЕНЬ ВАЖНАЯ ПРОВЕРКА: убедимся что используются разные токены
if (process.env.BOT_TOKEN && process.env.BOT_TOKEN_DEV) {
  const mainTokenEnd = process.env.BOT_TOKEN.slice(-10);
  const devTokenEnd = process.env.BOT_TOKEN_DEV.slice(-10);
  console.log(`  - BOT_TOKEN ends with: ...${mainTokenEnd}`);
  console.log(`  - BOT_TOKEN_DEV ends with: ...${devTokenEnd}`);
  
  if (mainTokenEnd === devTokenEnd) {
    console.log('❌ КРИТИЧЕСКАЯ ОШИБКА: BOT_TOKEN и BOT_TOKEN_DEV одинаковые!');
    console.log('💡 Это вызывает конфликт 409! Используйте разные токены для Preview и Deploy');
  } else {
    console.log('✅ Токены разные - это правильно!');
  }
}

if (isDeployment) {
  // Deploy/Production - используем основной BOT_TOKEN
  botToken = process.env.BOT_TOKEN || '';
  console.log('🚀 Using DEPLOY bot (BOT_TOKEN)');
  console.log(`🔍 Deploy token ends with: ...${process.env.BOT_TOKEN?.slice(-6) || 'NONE'}`);
} else {
  // Preview/Development - используем PREVIEW токен для избежания 409 конфликтов
  botToken = process.env.BOT_TOKEN_PREVIEW || process.env.BOT_TOKEN_DEV || '';
  console.log('🔧 Using PREVIEW bot in development (BOT_TOKEN_PREVIEW) - avoiding 409');
  const devToken = process.env.BOT_TOKEN_PREVIEW || process.env.BOT_TOKEN_DEV;
  console.log(`🔍 Preview token ends with: ...${devToken?.slice(-6) || 'NONE'}`);
}

if (!botToken) {
  const environment = isDeployment ? 'deploy' : 'preview';
  console.error(`❌ No bot token found for ${environment} environment!`);
  console.log('💡 Set the appropriate token:');
  console.log('  - Preview (Replit Workspace): BOT_TOKEN_DEV');
  console.log('  - Deploy (Replit Deploy): BOT_TOKEN');
  
  // Debug info
  console.log('🔍 Debug info:');
  console.log(`  - isDeployment: ${isDeployment}`);
  console.log(`  - NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`  - REPLIT_DEPLOYMENT: ${process.env.REPLIT_DEPLOYMENT}`);
  console.log(`  - BOT_TOKEN exists: ${!!process.env.BOT_TOKEN}`);
  console.log(`  - BOT_TOKEN_DEV exists: ${!!process.env.BOT_TOKEN_DEV}`);
}

const bot = new Telegraf(botToken);

(async () => {
  const me = await bot.telegram.getMe();
  console.log(`🤖 Bot identity: @${me.username} (id=${me.id})`);
})().catch(console.error);

// ⬇️ ДОЛЖНО ИДТИ СРАЗУ ПОСЛЕ СОЗДАНИЯ bot, ДО ЛЮБЫХ ДРУГИХ HANDLERS
bot.use(async (ctx, next) => {
  const text = (ctx.message as any)?.text as string | undefined;
  if (!text) return next();

  const uid = ctx.from?.id;
  if (!uid) return next();

  // читаем состояние мастера "контроль"
  const key = controlKeyFor(uid);
  const raw = await storage.getBotSetting(key);
  if (!raw) return next();

  const state = JSON.parse(raw) as { humanId: string; step?: string; assignedTo?: string };

  // ждём ввод @username или ID → перехватываем здесь и не пропускаем дальше
  if (state.step === "wait_assignee_input") {
    const input = text.trim();
    if (!input) {
      await ctx.reply("Пришлите @username или Telegram ID числом.");
      return; // НЕ зови next()
    }

    state.assignedTo = input;      // сохраняем как есть (например, '@thenlao' или '5477...')
    state.step = "wait_due";       // шаг выбора срока
    await storage.setBotSetting(key, JSON.stringify(state));

    await askDue(ctx, state.humanId); // покажем кнопки «Сегодня / +1 / +3 / Своя дата»
    return; // критично: больше НИЧЕГО не обрабатываем
  }

  // если не наш шаг — отдаём дальше
  return next();
});

// 2) логгер всех апдейтов (видно, доходят ли сообщения вообще)
bot.use(async (ctx, next) => {
  const t = (ctx.message as any)?.text || (ctx.message as any)?.caption || ctx.updateType;
  console.log(`📩 update: from=${ctx.from?.id}/${ctx.from?.username || ""} type=${ctx.updateType} text="${t}"`);
  return next();
});

// 1) Поиск по #ID (текст)
// используй hears с регекспом — он сработает только когда в тексте есть #ID
const RE_ID = /\b#?(D-\d{6})\b/i;
const RE_FIXED_CAPTION = /\b(устранен[оа]?|закрыт[оа]?|fixed)\b.*\b#?(D-\d{6})\b/i;
bot.hears(RE_ID, handleIdQueryText);



// 3) Карточка: кнопки
bot.action(/^def_add_after:(D-\d{6})$/i, startAddAfter);
// bot.action(/^def_set_control:(D-\d{6})$/i, setStatusControl); // replaced by control menu
bot.action(/^def_set_discovered:(D-\d{6})$/i, setStatusDiscovered);
bot.action(/^def_set_fixed:(D-\d{6})$/i, setStatusFixed);
bot.action(/def_open:(.+)/, async (ctx) => {
  const humanId = (ctx.callbackQuery as any).data.split(":")[1];
  await ctx.answerCbQuery().catch(()=>{});
  await showDefectCard(ctx, humanId);
});

bot.action(/list:(.+):(\d+)/, async (ctx) => {
  const m = ((ctx.callbackQuery as any).data as string).match(/list:(.+):(\d+)/);
  if (!m) return;
  await ctx.answerCbQuery().catch(()=>{});
  const kind = m[1] as any;
  const page = Number(m[2]);
  // Delegate to list handlers registered in botHandlers
  const mod = await import('./botHandlers');
  const fn = (mod as any).sendDefectsList as (ctx: any, kind: any, page?: number) => Promise<void>;
  if (typeof fn === 'function') {
    await fn(ctx as any, kind, page);
  }
});

// Кнопка запуска мастера
bot.action("defect_start", handleDefectStart);

// Referral system
bot.command('ref', handleReferral);
bot.action('referrals', handleReferral);

// Reset command for defect draft/after
bot.command('def_reset', handleDefReset);

// ===== Reports =====
bot.command("report", async (ctx) => {
  await ctx.reply("Выберите период и формат отчёта:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "За 7 дней (PDF)", callback_data: "report:7d:pdf" },
          { text: "За 7 дней (Excel)", callback_data: "report:7d:xlsx" },
        ],
        [
          { text: "За 30 дней (PDF)", callback_data: "report:30d:pdf" },
          { text: "За 30 дней (Excel)", callback_data: "report:30d:xlsx" },
        ],
      ],
    },
  } as any);
});
// Открыть меню отчётов из главной кнопки (callback_data: "reports")
bot.action('reports', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('Выберите период и формат отчёта:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'За 7 дней (PDF)',  callback_data: 'report:7d:pdf'  },
          { text: 'За 7 дней (Excel)', callback_data: 'report:7d:xlsx' },
        ],
        [
          { text: 'За 30 дней (PDF)',  callback_data: 'report:30d:pdf'  },
          { text: 'За 30 дней (Excel)', callback_data: 'report:30d:xlsx' },
        ],
      ],
    },
  } as any);
});
// Нажатие кнопки в главном меню
bot.hears("📑 Отчёты", async (ctx) => {
  await ctx.reply("Выберите период и формат отчёта:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "За 7 дней (PDF)",  callback_data: "report:7d:pdf"  },
          { text: "За 7 дней (Excel)", callback_data: "report:7d:xlsx" },
        ],
        [
          { text: "За 30 дней (PDF)",  callback_data: "report:30d:pdf"  },
          { text: "За 30 дней (Excel)", callback_data: "report:30d:xlsx" },
        ],
      ],
    },
  } as any);
});

bot.action(/^report:(7d|30d):(pdf|xlsx)$/i, async (ctx) => {
  const data = (ctx.callbackQuery as any).data as string;
  const m = data.match(/^report:(7d|30d):(pdf|xlsx)$/i);
  if (!m) return;
  await ctx.answerCbQuery().catch(() => {});

  const tag = m[1].toLowerCase() as "7d" | "30d";
  const fmt = m[2].toLowerCase();
  const to = new Date();
  const from = new Date(to.getTime() - (tag === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000);

  await ctx.reply("Готовлю отчёт...");

  if (fmt === "pdf") {
    const buf = await generateReportPDF(ctx, { from, to });
    await ctx.replyWithDocument({
      source: buf,
      filename: `report_${tag}.pdf`,
    });
  } else {
    const buf = await generateReportExcel({ from, to });
    await ctx.replyWithDocument({ source: buf, filename: `report_${tag}.xlsx` });
  }
});

// Перехват текстового ввода для редактирования существующей карточки
// (расположи ЭТОТ хендлер ДО общих обработчиков текстов мастера, чтобы не перехватывалось мастером)
bot.on(message("text"), (ctx, next) => onDefCardEditText(ctx, next));

// Поток мастера
bot.start(handleStart);
bot.command("menu", handleStart);
bot.on(message("text"), onDefectText);
bot.action(/^def_cat:.+$/, onDefCategory);
bot.action(/^def_sev:.+$/, onDefSeverity);
bot.action("def_save", onDefSave);
bot.action("def_cancel", onDefCancel);
bot.action(/^def_edit:(object|floor)$/i, onDefEdit);

bot.action("def_edit_menu", onDefEditMenu);
bot.action(/^def_edit:(object|floor|description|photos)$/i, onDefEdit);
bot.action("def_photos_clear", onDefPhotosClear);
bot.action("def_preview_back", onDefPreviewBack);

// Кнопка «✏️ Редактировать карточку» в карточке дефекта
bot.action(/^def_edit_def:[A-Z]-\d{6}$/i, onDefCardEditMenu);

// Выбор поля для редактирования
bot.action(/^def_edit_field:(object|floor|description):[A-Z]-\d{6}$/i, onDefCardEditField);



bot.on(message("text"), (ctx, next) => onControlWizardText(ctx, next));

// Кнопки мастера контроля
// Control wizard (regex-based to allow flexible IDs)
bot.action(/def_ctl_menu:.+/, controlMenu);
bot.action(/def_assign_me:.+/, controlAssignMe);
bot.action(/def_assign_enter:.+/, controlAssignEnter);
bot.action(/def_ctl_cancel:.+/, controlAssignCancel);

bot.action(/def_due_today:.+/, controlDueToday);
bot.action(/def_due_p1:.+/,    controlDuePlus1);
bot.action(/def_due_p3:.+/,    controlDuePlus3);
bot.action(/def_due_custom:.+/, controlDueCustom);

// Function to get current AI settings (to avoid circular dependency)
function getCurrentAIModel(): string {
  try {
    const settings = getCurrentAISettings();
    return settings.imageGenerationModel;
  } catch (error) {
    console.error('Error getting AI settings:', error);
    return "polza-nano-banana"; // fallback
  }
}

// Middleware to ensure user exists in database
bot.use(async (ctx, next) => {
  console.log('📩 Received update:', {
    updateType: ctx.updateType,
    fromId: ctx.from?.id,
    username: ctx.from?.username,
    text: ctx.message && 'text' in ctx.message ? ctx.message.text : undefined
  });
  
  if (ctx.from) {
    let user = await storage.getUserByTelegramId(ctx.from.id.toString());
    if (!user) {
      // Handle referral on user creation
      let referredBy: string | undefined;
      
      if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/start ref_')) {
        const referralCode = ctx.message.text.split('ref_')[1];
        // const referrer = await storage.getUserByReferralCode(referralCode);
        // if (referrer) {
        //   referredBy = referrer.id;
        // }
      }
      
      user = await storage.createUser({
        telegramId: ctx.from.id.toString(),
        username: ctx.from.username || undefined,
        firstName: ctx.from.first_name || undefined,
        lastName: ctx.from.last_name || undefined,
        referredBy
      });

      // Temporarily disable referral creation
      // if (referredBy) {
      //   await storage.createReferral(referredBy, user.id);
      // }
    } else {
      // Update last activity
      await storage.updateUser(user.id, { lastActivity: new Date() });
    }
    (ctx as any).user = user;
  }
  return next();
});

// Start command and referral handling
bot.start(async (ctx) => {
  console.log('🚀 START command received from user:', ctx.from?.id);
  const text = ctx.message.text;
  // Temporarily disable referral handling
  // if (text.includes('ref_')) {
  //   const referralCode = text.split('ref_')[1];
  //   const referrer = await storage.getUserByReferralCode(referralCode);
  //   const user = (ctx as any).user;
  //   
  //   if (referrer && user && !user.referredBy) {
  //     // Update user with referrer
  //     await storage.updateUser(user.id, { referredBy: referrer.id });
  //     await storage.createReferral(referrer.id, user.id);
  //     
  //     ctx.reply(
  //       '🎉 Добро пожаловать! Вы перешли по реферальной ссылке.\n' +
  //       'После использования любого ИИ-агента ваш друг получит бонусную попытку.\n\n'
  //     );
  //   }
  // }
  
  return handleStart(ctx);
});

// Main menu handlers
bot.action('start', handleStart);
bot.action('renovation', handleRenovation);
bot.action('inspector', handleInspector);
bot.action('designer', handleDesigner);
bot.action('how_we_work', handleHowWeWork);
bot.action('website', (ctx) => {
  if (ctx.callbackQuery) {
    ctx.answerCbQuery();
  }
  ctx.reply('🌐 Посетите наш сайт: https://nemo.moscow\n\nNEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.');
});
bot.action('office', (ctx) => {
  if (ctx.callbackQuery) {
    ctx.answerCbQuery();
  }
  ctx.reply('🗺 Наш офис на Яндекс.Картах: https://yandex.ru/maps/org/nemo_moscow\n\nNEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.');
});
bot.action('leave_request', handleLeaveRequest);

// Renovation detail handlers
bot.action('renovation_includes', handleRenovationIncludes);
bot.action('quality_control', handleQualityControl);

// Consultation handlers
bot.action('consultation', handleConsultation);
bot.action('discuss_project', handleDiscussProject);

// Subscription and limits
bot.action('check_subscription', handleSubscriptionCheck);
bot.action('limits', handleLimitsCheck);

// Payment handlers
bot.action('buy_requests', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    '💳 Выберите пакет дополнительных запросов:',
    { reply_markup: getPaymentKeyboard() }
  );
});

bot.action(/^buy_requests_/, async (ctx) => {
  await ctx.answerCbQuery();
  const packageId = ctx.match[0].replace('buy_', '');
  
  try {
    await createInvoice(ctx, packageId);
  } catch (error) {
    console.error('Error creating invoice:', error);
    ctx.reply('Ошибка при создании счёта. Попробуйте позже.');
  }
});

// Designer quiz handlers
bot.action('style_minimalism', (ctx) => handleStyleSelection(ctx, 'minimalism'));
bot.action('style_loft', (ctx) => handleStyleSelection(ctx, 'loft'));
bot.action('style_classic', (ctx) => handleStyleSelection(ctx, 'classic'));
bot.action('style_scandi', (ctx) => handleStyleSelection(ctx, 'scandi'));

bot.action('priority_durability', (ctx) => handlePrioritySelection(ctx, 'durability'));
bot.action('priority_comfort', (ctx) => handlePrioritySelection(ctx, 'comfort'));
bot.action('priority_aesthetics', (ctx) => handlePrioritySelection(ctx, 'aesthetics'));
bot.action('priority_speed', (ctx) => handlePrioritySelection(ctx, 'speed'));

bot.action('accent_lighting', (ctx) => handleAccentSelection(ctx, 'lighting'));
bot.action('accent_furniture', (ctx) => handleAccentSelection(ctx, 'furniture'));
bot.action('accent_materials', (ctx) => handleAccentSelection(ctx, 'materials'));



// Payment processing
bot.on('pre_checkout_query', handlePreCheckoutQuery);
bot.on('successful_payment', handleSuccessfulPayment);

// Handle text messages (control wizard first, then forms)
bot.on(message('text'), async (ctx) => {
  // ⬇️ В САМОМ НАЧАЛЕ общего обработчика текста
  const uid = ctx.from!.id;
  const key = controlKeyFor(uid);
  const raw = await storage.getBotSetting(key);

  if (raw) {
    const state = JSON.parse(raw) as { humanId: string; step?: string; assignedTo?: string };

    if (state.step === "wait_assignee_input") {
      const input = (ctx.message!.text || "").trim();
      if (!input) {
        await ctx.reply("Пришлите @username или Telegram ID числом.");
        return;
      }

      // сохраняем как есть; DM отправим только если это число
      state.assignedTo = input; // можно хранить '@thenlao' или '5477727657'
      state.step = "wait_due";  // переходим к выбору срока
      await storage.setBotSetting(key, JSON.stringify(state));

      // спрашиваем срок
      await askDue(ctx, state.humanId);
      return; // ВАЖНО: больше ничего не обрабатывать в этом апдейте
    }
  }

  const user = (ctx as any).user;
  if (!user) return;

  // Check if user is in consultation form state
  const consultationFormState = await storage.getBotSetting(`consultation_form_${user.id}`);
  if (consultationFormState) {
    const state = JSON.parse(consultationFormState);
    
    switch (state.step) {
      case 'name':
        state.name = ctx.message.text;
        state.step = 'phone';
        await storage.setBotSetting(`consultation_form_${user.id}`, JSON.stringify(state));
        ctx.reply('📱 Введите ваш номер телефона:');
        break;
        
      case 'phone':
        state.phone = ctx.message.text;
        state.step = 'address';
        await storage.setBotSetting(`consultation_form_${user.id}`, JSON.stringify(state));
        
        if (state.source === 'designer_consultation') {
          ctx.reply('💬 Опишите ваши пожелания по дизайн-проекту:');
        } else {
          ctx.reply('🏠 Введите адрес объекта:');
        }
        break;
        
      case 'address':
        state.address = ctx.message.text;
        
        // Save consultation request
        await storage.createLeadRequest({
          userId: user.id,
          name: state.name,
          phone: state.phone,
          interest: `Консультация инженера. Адрес: ${state.address}`, // Store address/wishes in interest
          source: state.source
        });
        
        // Clear form state
        await storage.setBotSetting(`consultation_form_${user.id}`, '');
        
        const responseMessage = state.source === 'designer_consultation' ? 
          '✅ Спасибо! Заявка на дизайн-консультацию принята.\n' +
          'Наш дизайнер свяжется с вами для обсуждения проекта.\n\n' +
          'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.' :
          '✅ Спасибо! Заявка на консультацию принята.\n' +
          'Наш инженер свяжется с вами для обсуждения объекта.\n\n' +
          'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.';
        
        ctx.reply(responseMessage, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 Главное меню', callback_data: 'start' }],
              [{ text: '🌐 Сайт', callback_data: 'website' }, { text: '🗺 Офис', callback_data: 'office' }]
            ]
          }
        });
        break;
    }
    return; // Exit early if consultation form was handled
  }

  // Check if user is in lead form state
  const formState = await storage.getBotSetting(`lead_form_${user.id}`);
  if (formState) {
    const state = JSON.parse(formState);
    
    switch (state.step) {
      case 'name':
        state.name = ctx.message.text;
        state.step = 'phone';
        await storage.setBotSetting(`lead_form_${user.id}`, JSON.stringify(state));
        ctx.reply('📱 Введите ваш номер телефона:');
        break;
        
      case 'phone':
        state.phone = ctx.message.text;
        
        // Save lead request
        await storage.createLeadRequest({
          userId: user.id,
          name: state.name,
          phone: state.phone,
          interest: state.interest,
          source: state.source || 'main_menu'
        });
        
        // Clear form state
        await storage.setBotSetting(`lead_form_${user.id}`, '');
        
        ctx.reply(
          '✅ Спасибо! Ваша заявка принята.\n' +
          'Наш инженер свяжется с вами в ближайшее время.\n\n' +
          'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🏠 Главное меню', callback_data: 'start' }],
                [{ text: '🌐 Сайт', callback_data: 'website' }, { text: '🗺 Офис', callback_data: 'office' }]
              ]
            }
          }
        );
        break;
    }
  }
});

// Register list commands/pagination/actions
registerListCommands(bot);

// Handle photos for AI agents  — ДОЛЖЕН ИДТИ ВЫШЕ дефектных хендлеров!
bot.on(message('photo'), async (ctx, next) => {
  const appUser = (ctx as any).user;   // это ID из БД (нужен для aiRequests)
  const uid = ctx.from!.id;            // это Telegram ID — используем для botSettings
  if (!appUser || !uid) return next();

  // 👇 ВСЕ botSettings проверяем по Telegram ID
  const draft = await storage.getBotSetting(`defect_draft_${uid}`);
  const after = await storage.getBotSetting(`defect_after_${uid}`);
  if (draft || after) return next();

  const agentState = await storage.getBotSetting(`agent_state_${uid}`);
  if (!agentState) return next();

  const state = JSON.parse(agentState);

  const fileId = ctx.message.photo.at(-1)!.file_id;
  const link = await ctx.telegram.getFileLink(fileId);
  const imageUrl = link.href;

  // очищаем агент по Telegram ID
  await storage.setBotSetting(`agent_state_${uid}`, '');

  if (state.agent === 'inspector') {
    const aiRequest = await storage.createAiRequest({
      userId: appUser.id,    // ← ID из БД
      agentType: 'inspector',
      imageUrl,
      status: 'processing'
    });
    await ctx.reply('🔍 Анализирую фото... Это может занять до 60 секунд.');
    return processInspectorRequest(aiRequest.id, imageUrl, ctx);
  }

  if (state.agent === 'designer') {
    const quizData = await storage.getBotSetting(`design_quiz_${uid}`);
    const quiz = quizData ? JSON.parse(quizData) : {};
    const aiRequest = await storage.createAiRequest({
      userId: appUser.id,    // ← ID из БД
      agentType: 'designer',
      imageUrl,
      status: 'processing'
    });
    await ctx.reply('🎨 Готовлю концепцию... Это может занять до 60 секунд.');
    return processDesignerRequest(
      aiRequest.id,
      imageUrl,
      quiz.style || 'современный',
      quiz.priority || 'эстетика',
      quiz.accent || 'общий',
      ctx
    );
  }

  return next();
});

// 2) Фото с подписью «Устранено #ID»
bot.on(message("photo"), (ctx, next) => handleFixByCaption(ctx, next));

// 2) Режим «после» — сквозной, если режим не активен (см. п.1)
bot.on(message("photo"), (ctx, next) => onAfterPhoto(ctx, next));

bot.on(message("photo"), (ctx, next) => onDefectPhoto(ctx, next));

async function processInspectorRequest(requestId: string, imageUrl: string, ctx: Context) {
  const startTime = Date.now();
  
  try {
    const analysis = await analyzeConstructionImage(imageUrl);
    const processingTime = Math.round((Date.now() - startTime) / 1000);
    
    const report = formatInspectionReport(analysis);
    
    await storage.updateAiRequest(requestId, {
      response: report,
      status: 'completed',
      completedAt: new Date(),
      processingTime
    });
    
    ctx.reply(
      report + '\n\n' +
      'Вы обратились к ИИ-Технадзору от NEMO Moscow — контроль качества ремонта от профессионалов.\n\n' +
      'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👨‍🔧 Консультация инженера', callback_data: 'consultation' }],
            [{ text: '📊 Остаток попыток', callback_data: 'limits' }],
            [{ text: '🏠 Главное меню', callback_data: 'start' }]
          ]
        }
      }
    );

    // Temporarily disable referral bonus
    // const user = (ctx as any).user;
    // if (user?.referredBy) {
    //   const referral = await storage.getReferralByUsers(user.referredBy, user.id);
    //   if (referral && !referral.bonusGranted) {
    //     await storage.grantReferralBonus(referral.id);
    //     await storage.incrementUserRequests(user.referredBy, 1);
    //   }
    // }
    
  } catch (error) {
    console.error('Inspector processing error:', error);
    await storage.updateAiRequest(requestId, {
      status: 'failed',
      response: 'Ошибка обработки изображения'
    });
    
    ctx.reply('❌ Ошибка при анализе изображения. Попробуйте позже.');
  }
}

async function processDesignerRequest(
  requestId: string, 
  imageUrl: string, 
  style: string, 
  priority: string, 
  accent: string, 
  ctx: Context
) {
  const startTime = Date.now();
  
  try {
    const currentModel = getCurrentAIModel();
    console.log('🤖 Using AI model for design generation:', currentModel);
    const design = await generateDesignConcept(imageUrl, style, priority, accent, currentModel);
    const processingTime = Math.round((Date.now() - startTime) / 1000);
    
    const report = formatDesignReport(design);
    
    await storage.updateAiRequest(requestId, {
      response: report,
      status: 'completed',
      completedAt: new Date(),
      processingTime
    });
    
    let message = report + '\n\n';
    
    // Add note if no image was generated
    if (!design.imageUrl) {
      message += '📝 Примечание: Генерация визуализации временно недоступна, но дизайн-концепция готова!\n\n';
    }
    
    message += 'Так может выглядеть ваш интерьер — мы заботимся о красивом, долговечном и стильном результате.\n\n' +
      'NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.';
    
    console.log('🖼️ Checking for generated image...');
    console.log('🖼️ design.imageUrl exists:', !!design.imageUrl);
    console.log('🖼️ design.imageUrl type:', typeof design.imageUrl);
    
    const replyMarkup = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎨 Обсудить проект', callback_data: 'discuss_project' }],
          [{ text: '📊 Остаток попыток', callback_data: 'limits' }],
          [{ text: '🏠 Главное меню', callback_data: 'start' }]
        ]
      }
    };
    
    if (design.imageUrl) {
      console.log('✅ Attempting to send image with caption to Telegram...');
      console.log('🔗 Image URL/data length:', design.imageUrl.length);
      console.log('🔗 Image format:', design.imageUrl.startsWith('data:') ? 'base64' : 'URL');
      
      try {
        // For base64 images, convert to buffer for Telegram
        if (design.imageUrl.startsWith('data:')) {
          console.log('📝 Converting base64 to buffer for Telegram...');
          const base64Data = design.imageUrl.split(',')[1];
          const imageBuffer = Buffer.from(base64Data, 'base64');
          console.log('📏 Buffer size:', imageBuffer.length, 'bytes');
          
          await ctx.replyWithPhoto({ source: imageBuffer }, { 
            caption: message,
            parse_mode: 'Markdown',
            ...replyMarkup 
          });
          console.log('✅ Base64 image with caption sent successfully to Telegram');
        } else {
          await ctx.replyWithPhoto(design.imageUrl, { 
            caption: message,
            parse_mode: 'Markdown',
            ...replyMarkup 
          });
          console.log('✅ URL image with caption sent successfully to Telegram');
        }
      } catch (imageError) {
        console.error('❌ Failed to send image with caption to Telegram:', imageError);
        console.error('❌ Error details:', JSON.stringify(imageError, null, 2));
        
        // Fallback: send text only with buttons
        await ctx.reply(message, replyMarkup);
        console.log('✅ Sent text-only fallback message with buttons');
      }
    } else {
      console.log('⚠️ No image URL available, sending text only with buttons');
      await ctx.reply(message, replyMarkup);
    }

    // Temporarily disable referral bonus
    // const user = (ctx as any).user;
    // if (user?.referredBy) {
    //   const referral = await storage.getReferralByUsers(user.referredBy, user.id);
    //   if (referral && !referral.bonusGranted) {
    //     await storage.grantReferralBonus(referral.id);
    //     await storage.incrementUserRequests(user.referredBy, 1);
    //   }
    // }
    
  } catch (error) {
    console.error('Designer processing error:', error);
    await storage.updateAiRequest(requestId, {
      status: 'failed',
      response: 'Ошибка генерации дизайна'
    });
    
    ctx.reply('❌ Ошибка при создании дизайна. Попробуйте позже.');
  }
}

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('Произошла ошибка. Попробуйте позже.\n\nNEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.');
});

export { bot };

import {
  handleDefectStart,
  onDefectPhoto,
  onDefectText,
  onDefCategory,
  onDefSeverity,
  onDefSave,
  onDefCancel,
} from "./botHandlers";

// меню списков
bot.action("lists_menu", handleListsMenu);

// кнопки списков + защита
bot.action(/list:([a-z_]+):(\d+)/i, async (ctx) => {
  try {
    const data = (ctx.callbackQuery as any).data as string;
    const m = data.match(/list:([a-z_]+):(\d+)/i);
    if (!m) return;

    const kind = m[1] as any;
    const page = Number(m[2]);

    console.log("[lists] kind=%s page=%d from=%s", kind, page, ctx.from?.id);
    await ctx.answerCbQuery().catch(() => {});
    await sendDefectsList(ctx, kind, page);
  } catch (e) {
    console.error("❌ list action failed:", e);
    await ctx.reply("⚠️ Не удалось загрузить список. Попробуйте ещё раз.");
  }
});

// Фолбэк: мастер активен, но пользователь прислал не фото и не текст
// Фолбэк: мастер активен, но прилетело «не то»
// Делаем подсказку по текущему step черновика
bot.on('message', async (ctx, next) => {
  try {
    const uid = ctx.from?.id;
    if (!uid) return next();

    const raw = await storage.getBotSetting(`defect_draft_${uid}`);
    if (!raw) return next(); // мастер не активен — пропускаем

    const draft = JSON.parse(raw);
    const step = draft?.step ?? "photo";

    const msg: any = ctx.message;
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const textRaw  = typeof msg.text === 'string' ? msg.text : undefined;
    const hasText  = !!textRaw && textRaw.trim().length > 0;

    // Подсказываем в зависимости от ожидаемого шага
    if (step === "photo") {
      if (!hasPhoto) {
        await ctx.reply(
          "Мне нужно *фото дефекта* (JPG/PNG). " +
          "GIF/стикеры/видео не подойдут. " +
          "Пришлите фото — дальше я спрошу объект, этаж и описание.",
          { parse_mode: "Markdown" }
        );
        return;
      }
      // если фото — пусть идёт дальше в onDefectPhoto
      return next();
    }

    // На текстовых шагах просим текст, если прилетел стикер/гиф/фото и т.п.
    if ((step === "object" || step === "floor" || step === "description") && !hasText) {
      if (step === "object") {
        await ctx.reply("Пожалуйста, укажите *объект*. Пример: «ЖК Лесной, корпус 3»", { parse_mode: "Markdown" });
      } else if (step === "floor") {
        await ctx.reply("Пожалуйста, укажите *этаж* (число или секцию). Пример: «3» или «Секция B, 5»", { parse_mode: "Markdown" });
      } else {
        await ctx.reply("Пожалуйста, *кратко опишите проблему*. Пример: «Трещина в штукатурке на откосе»", { parse_mode: "Markdown" });
      }
      return; // не шумим дальше
    }

    // Иначе не вмешиваемся — пусть обрабатывают профильные хендлеры
    return next();
  } catch (err) {
    console.error("[defect-master][fallback-by-step]", err);
    return next();
  }
});

bot.action("defect_start", handleDefectStart);

bot.use(ensureUser as any);   // ранним middleware
registerListCommands(bot);

// Команды управления сессией фотофиксации
bot.command("cancel", async (ctx) => {
  if (ctx.from?.id) clearAfterMode(ctx.from.id);
  await ctx.reply("❎ Режим добавления «после»-фото сброшен. Отправьте фото, чтобы начать новый дефект.");
});
bot.command(["new", "newdefect"], async (ctx) => {
  if (ctx.from?.id) clearAfterMode(ctx.from.id);
  await ctx.reply("🆕 Новый дефект: пришлите фото для фиксации «было».");
});

// Универсальный обработчик фото
bot.on("photo", async (ctx) => {
  const uid = ctx.from?.id!;
  const sizes = (ctx.message as any).photo;
  const fileId = sizes[sizes.length - 1].file_id;

  const mode = getAfterMode(uid);
  if (mode) {
    // здесь вызови твою функцию добавления «после»-фото:
    // await storage.addDefectPhoto({ defectId: mode.defectId, kind: "after", fileId })
    await ctx.reply(`📎 Добавил «после» к #D-${String(mode.defectId).padStart(6, "0")}. Можно отправить ещё или нажать ✅ Устранено.`);
    return;
  }

  // запускаем новый дефект (дальше — твоя реальная логика)
  // const defectId = await storage.createDefectForUser(uid, ...);
  // await storage.addDefectPhoto({ defectId, kind: "initial", fileId })
  await ctx.reply("📌 Создан новый дефект. Фото «было» сохранено. Можете добавить ещё фото или задать параметры.");
});
