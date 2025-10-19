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
};

export async function sendLeadEmail(lead: LeadPayload) {
  const to = process.env.LEAD_NOTIFY_TO || process.env.SMTP_USER!;
  const subject = `Новая заявка: ${lead.name || lead.username || lead.tgId}`;
  const html = `
    <h3>Новая заявка из Telegram</h3>
    <ul>
      <li><b>Telegram:</b> ${lead.username ? "@" + esc(lead.username) : lead.tgId}</li>
      <li><b>Имя:</b> ${esc(lead.name)}</li>
      <li><b>Телефон:</b> ${esc(lead.phone)}</li>
      <li><b>Комментарий:</b> ${esc(lead.message)}</li>
      <li><b>Источник:</b> ${esc(lead.source || "telegram")}</li>
      <li><b>Дата:</b> ${new Date().toLocaleString("ru-RU")}</li>
    </ul>
  `;

  await transporter.sendMail({
    from: `"NEMO Bot" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}
