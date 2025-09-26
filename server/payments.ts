import { Context } from 'telegraf';
import { storage } from './storage';

export interface PaymentPackage {
  id: string;
  title: string;
  description: string;
  requests: number;
  price: number; // in rubles
  currency: string;
}

export const paymentPackages: PaymentPackage[] = [
  {
    id: 'requests_3',
    title: '+3 запроса',
    description: '3 дополнительных запроса к ИИ-агентам',
    requests: 3,
    price: 299,
    currency: 'RUB'
  },
  {
    id: 'requests_10',
    title: '+10 запросов',
    description: '10 дополнительных запросов к ИИ-агентам',
    requests: 10,
    price: 799,
    currency: 'RUB'
  }
];

export async function createInvoice(ctx: Context, packageId: string) {
  const user = (ctx as any).user;
  if (!user) {
    throw new Error('User not found');
  }

  const paymentPackage = paymentPackages.find(p => p.id === packageId);
  if (!paymentPackage) {
    throw new Error('Payment package not found');
  }

  // Create payment record in pending status
  const payment = await storage.createPayment({
    userId: user.id,
    amount: paymentPackage.price.toString(),
    currency: paymentPackage.currency,
    requestsAdded: paymentPackage.requests,
    status: 'pending'
  });

  const invoice = {
    title: paymentPackage.title,
    description: paymentPackage.description,
    payload: payment.id, // Use our payment ID as payload
    currency: paymentPackage.currency,
    prices: [
      {
        label: paymentPackage.title,
        amount: paymentPackage.price * 100 // Telegram expects price in kopecks
      }
    ]
  };

  await ctx.replyWithInvoice(invoice);
}

export async function handlePreCheckoutQuery(ctx: Context) {
  try {
    // In a real implementation, you would validate the payment here
    await ctx.answerPreCheckoutQuery(true);
  } catch (error) {
    console.error('Pre-checkout error:', error);
    await ctx.answerPreCheckoutQuery(false, 'Payment validation failed');
  }
}

export async function handleSuccessfulPayment(ctx: Context) {
  const user = (ctx as any).user;
  if (!user || !ctx.message?.successful_payment) {
    return;
  }

  const successfulPayment = ctx.message.successful_payment;
  const paymentId = successfulPayment.invoice_payload;

  try {
    // Update payment status and add requests to user
    const payment = await storage.updatePayment(paymentId, {
      status: 'completed',
      telegramPaymentChargeId: successfulPayment.telegram_payment_charge_id,
      completedAt: new Date()
    });

    // Add purchased requests to user
    const currentUser = await storage.getUser(user.id);
    if (currentUser) {
      await storage.updateUser(user.id, {
        totalPurchasedRequests: currentUser.totalPurchasedRequests + payment.requestsAdded
      });
    }

    ctx.reply(
      `✅ Платёж успешно обработан!\n` +
      `Добавлено ${payment.requestsAdded} запросов к ИИ-агентам.\n\n` +
      `NEMO Moscow — ремонт под ключ, надзор и дизайн с гарантией.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 Остаток попыток', callback_data: 'limits' }],
            [{ text: '🏠 Главное меню', callback_data: 'start' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Error processing successful payment:', error);
    
    ctx.reply(
      'Платёж получен, но возникла ошибка при обработке. ' +
      'Свяжитесь с поддержкой для решения вопроса.'
    );
  }
}

export function getPaymentKeyboard() {
  return {
    inline_keyboard: paymentPackages.map(pkg => [
      { text: `${pkg.title} - ₽${pkg.price}`, callback_data: `buy_${pkg.id}` }
    ]).concat([
      [{ text: '🏠 Главное меню', callback_data: 'start' }]
    ])
  };
}
