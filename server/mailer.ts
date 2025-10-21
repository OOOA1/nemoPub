// server/mailer.ts
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.yandex.ru",
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE ?? "true").toLowerCase() === "true",
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
  },
});

function esc(s?: string) {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type LeadPayload = {
  tgId: number;
  username?: string;
  name?: string;
  phone?: string;
  message?: string;
  source?: string;
  quiz?: LeadQuiz;
};

// --- типы для квиза (добавить сверху рядом с LeadPayload)
export type LeadQuiz = {
  property?: {
    kind?: 'new_flat' | 'old_flat' | 'house' | 'commercial';
    area_band?: 'lt50' | '50_100' | 'gt100';
    address?: string;
    space_type?: 'apartment' | 'office' | 'retail' | 'shop' | 'other';
    area_exact?: number;
  };
  design_project?: 'have' | 'none' | 'need';
  renovation?: { type?: 'rough' | 'cosmetic' | 'designer' | 'capital' };
};

const RU = {
  kind: {
    new_flat: 'Квартира (новостройка)',
    old_flat: 'Квартира (вторичка)',
    house: 'Дом / коттедж',
    commercial: 'Коммерческий объект',
  } as const,
  areaBand: {
    lt50: 'до 50 м²',
    '50_100': '50–100 м²',
    gt100: '100+ м²',
  } as const,
  design: {
    have: 'Есть',
    none: 'Нет',
    need: 'Нужен',
  } as const,
  rtype: {
    rough: 'Черновой',
    cosmetic: 'Косметический',
    designer: 'Дизайнерский',
    capital: 'Капитальный',
  } as const,
  space: {
    apartment: 'квартира',
    office: 'офис',
    retail: 'торговое помещение',
    shop: 'магазин',
    other: 'другое',
  } as const,
};

function telLink(phone?: string) {
  if (!phone) return '';
  const normalized = phone.replace(/[^\d+]/g, '');
  return `<a href="tel:${normalized}">${esc(phone)}</a>`;
}
function tgLink(username?: string, tgId?: number) {
  if (username) return `<a href="https://t.me/${username}">@${esc(username)}</a>`;
  if (tgId) return `id: ${tgId}`;
  return '';
}

export async function sendLeadEmail(lead: LeadPayload): Promise<boolean> {
  const url = process.env.MAILER_URL;
  if (!url) { console.error("MAILER_URL is not set"); return false; }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.MAILER_TOKEN) headers.authorization = `Bearer ${process.env.MAILER_TOKEN}`;

  const subject = String(lead?.source || "").includes("consult")
    ? "Консультация от Telegram-бота"
    : "Заявка от Telegram-бота";

  const to = process.env.LEAD_NOTIFY_TO || undefined;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ to, subject, lead }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error("MAILER ERROR:", res.status, await res.text().catch(()=>""));
      return false;
    }
    return true;
    } catch (err: any) {
      clearTimeout(t);
      console.error("MAILER REQUEST FAILED:", err?.message || err);
      console.error("CAUSE:", err?.cause); // тут часто ECONNRESET/ETIMEDOUT/ECONNREFUSED
      return false;
    }
}
