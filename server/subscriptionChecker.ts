import { bot } from './telegramBot';
import { storage } from './storage';

const CHANNEL_USERNAME = process.env.TELEGRAM_CHANNEL_USERNAME || '@nemo_moscow_channel';

export async function checkUserSubscription(telegramId: string): Promise<boolean> {
  try {
    const member = await bot.telegram.getChatMember(CHANNEL_USERNAME, parseInt(telegramId));
    
    // User is subscribed if they are a member, administrator, or creator
    const subscribedStatuses = ['member', 'administrator', 'creator'];
    return subscribedStatuses.includes(member.status);
  } catch (error) {
    console.error('Error checking subscription:', error);
    // If we can't check, assume not subscribed for security
    return false;
  }
}

export async function updateUserSubscriptionStatus(userId: string, telegramId: string): Promise<boolean> {
  const isSubscribed = await checkUserSubscription(telegramId);
  
  // Update user subscription status in database
  await storage.updateUserSubscription(userId, isSubscribed);
  
  return isSubscribed;
}

export async function requireSubscription(ctx: any, next: () => void) {
  const user = ctx.user;
  if (!user) {
    return ctx.reply('Ошибка: пользователь не найден');
  }

  // Check current subscription status
  const isSubscribed = await updateUserSubscriptionStatus(user.id, user.telegramId);

  if (!isSubscribed) {
    return ctx.reply(
      'Чтобы пользоваться ИИ-агентами, подпишитесь на наш канал:\n' +
      `👉 ${CHANNEL_USERNAME}\n\n` +
      'После подписки нажмите «Я подписался».\n\n' +
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

  // User is subscribed, continue to next handler
  return next();
}
