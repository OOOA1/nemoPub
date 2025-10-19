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

export async function sendLeadEmail(lead: LeadPayload) {
  const to = process.env.LEAD_NOTIFY_TO || process.env.SMTP_USER!;

  // собираем поля письма
  const subjParts = [
    lead.source?.toLowerCase().includes('consult') ? 'Консультация' : 'Заявка',
    lead.name ? `— ${lead.name}` : '',
    lead.phone ? `, ${lead.phone}` : '',
  ].join(' ').replace(/\s+,/g, ',').trim();

  const subject = subjParts || 'Новая заявка';

  const q = lead.quiz || {};

  const rowsUser = `
    <tr><td>Telegram</td><td>${tgLink(lead.username, lead.tgId)}</td></tr>
    <tr><td>Имя</td><td>${esc(lead.name)}</td></tr>
    <tr><td>Телефон</td><td>${telLink(lead.phone)}</td></tr>
    ${lead.message ? `<tr><td>Комментарий</td><td>${esc(lead.message)}</td></tr>` : ''}
    <tr><td>Источник</td><td>${esc(lead.source || 'telegram')}</td></tr>
    <tr><td>Дата</td><td>${new Date().toLocaleString('ru-RU')}</td></tr>
  `;

  const rowsQuiz = `
    ${
      q.property?.kind
        ? `<tr><td>Тип объекта</td><td>${RU.kind[q.property.kind]}</td></tr>`
        : ''
    }
    ${
      q.property?.area_band
        ? `<tr><td>Площадь (диапазон)</td><td>${RU.areaBand[q.property.area_band]}</td></tr>`
        : ''
    }
    ${
      q.design_project
        ? `<tr><td>Дизайн-проект</td><td>${RU.design[q.design_project]}</td></tr>`
        : ''
    }
    ${
      q.renovation?.type
        ? `<tr><td>Тип ремонта</td><td>${RU.rtype[q.renovation.type]}</td></tr>`
        : ''
    }
    ${q.property?.address ? `<tr><td>Адрес</td><td>${esc(q.property.address)}</td></tr>` : ''}
    ${
      q.property?.space_type
        ? `<tr><td>Тип помещения</td><td>${RU.space[q.property.space_type]}</td></tr>`
        : ''
    }
    ${
      typeof q.property?.area_exact === 'number'
        ? `<tr><td>Площадь точная</td><td>${q.property.area_exact}</td></tr>`
        : ''
    }
  `;

  const html = `
  <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#111; line-height:1.45;">
    <h2 style="margin:0 0 12px;">Новая заявка из Telegram</h2>

    <table style="border-collapse: collapse; width:100%; max-width:720px;">
      <thead>
        <tr>
          <th colspan="2" style="text-align:left; font-size:14px; color:#666; padding:8px 0;">Контакты</th>
        </tr>
      </thead>
      <tbody>
        ${rowsUser}
      </tbody>
    </table>

    ${
      rowsQuiz.replace(/\s/g, '') // если нет ни одной строки — не показываем блок
        ? `
      <div style="height:12px;"></div>
      <table style="border-collapse: collapse; width:100%; max-width:720px;">
        <thead>
          <tr>
            <th colspan="2" style="text-align:left; font-size:14px; color:#666; padding:8px 0;">Детали объекта</th>
          </tr>
        </thead>
        <tbody>
          ${rowsQuiz}
        </tbody>
      </table>`
        : ''
    }

    <div style="margin-top:16px; font-size:12px; color:#888;">
      Письмо сгенерировано автоматически ботом NEMO • Ответьте на это письмо, чтобы продолжить переписку с клиентом.
    </div>
  </div>
  `;

  await transporter.sendMail({
    from: `"NEMO Bot" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}
