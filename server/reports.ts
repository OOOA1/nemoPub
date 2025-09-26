// server/reports.ts
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename);
import type { Context } from "telegraf";
import {
  getReportStats,
  getReportByCategory,
  getReportBySeverity,
  getTopCriticalDefects,
} from "./storage";

type Period = { from: Date; to: Date };

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

/** Рендер диаграммы (Chart.js) через Puppeteer без нативных модулей */
async function renderChart(
  width: number,
  height: number,
  cfg: any,
): Promise<Buffer> {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html,body{margin:0;padding:0;background:#fff}
    #c{width:${width}px;height:${height}px}
  </style>
</head>
<body>
  <canvas id="c" width="${width}" height="${height}"></canvas>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script>
    const ctx = document.getElementById('c').getContext('2d');
    const cfg = ${JSON.stringify(cfg)};
    new Chart(ctx, cfg);
  </script>
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Небольшая задержка, чтобы Chart.js дорисовал
    await new Promise((res) => setTimeout(res, 200));

    const raw = await page.screenshot({ type: "png" }); // Buffer | Uint8Array
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
    return buf;
  } finally {
    await browser.close();
  }
}

export async function generateReportPDF(
  ctx: Context,
  period: Period,
): Promise<Buffer> {
  // === Найти Unicode-шрифт (кириллица) ===
  // Положи .ttf в assets/fonts/ (например, Roboto.ttf). Добавлен и твой ofont.ru_Roboto.ttf.
  const FONT_CANDIDATES = [
    path.join(__dirname2, "../assets/fonts/Roboto.ttf"),
    path.join(__dirname2, "../assets/fonts/ofont.ru_Roboto.ttf"),
    path.join(__dirname2, "../assets/fonts/Inter-Regular.ttf"),
    path.join(__dirname2, "../assets/fonts/DejaVuSans.ttf"),
  ];
  let fontPath: string | null = null;
  for (const p of FONT_CANDIDATES) {
    if (fs.existsSync(p)) {
      fontPath = p;
      break;
    }
  }

  const stats = await getReportStats(period.from, period.to);
  const byCat = await getReportByCategory(period.from, period.to);
  const bySev = await getReportBySeverity(period.from, period.to);
  const topCritical = await getTopCriticalDefects(period.from, period.to, 6);

  const pieCat = await renderChart(800, 380, {
    type: "pie",
    data: {
      labels: byCat.map((x) => x.category ?? "—"),
      datasets: [{ data: byCat.map((x) => x.count) }],
    },
    options: { plugins: { legend: { position: "bottom" } }, animation: false },
  });

  const barSev = await renderChart(800, 380, {
    type: "bar",
    data: {
      labels: bySev.map((x) => x.severity ?? "—"),
      datasets: [
        { label: "По критичности", data: bySev.map((x) => x.count) },
      ],
    },
    options: { plugins: { legend: { display: false } }, animation: false },
  });

  // === Создать PDF и подключить шрифт ===
  const doc = new PDFDocument({ size: "A4", margin: 36 });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done: Promise<Buffer> = new Promise((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );

  if (fontPath) {
    try {
      doc.registerFont("regular", fontPath);
      doc.font("regular");
    } catch (e) {
      console.warn("⚠️ Не удалось подключить шрифт:", fontPath, e);
    }
  } else {
    console.warn("⚠️ Unicode-шрифт не найден. Скопируй .ttf в assets/fonts/");
  }

  // Шапка
  doc.fontSize(18).text("Отчёт по дефектам", { align: "left" });
  doc.moveDown(0.3);
  doc
    .fontSize(12)
    .text(`Период: ${fmtDate(period.from)} — ${fmtDate(period.to)}`);
  doc.moveDown(0.8);

  // Сводка
  doc.fontSize(14).text("Сводка");
  doc.moveDown(0.2);
  doc.fontSize(12).list([
    `Обнаружено: ${stats.discovered}`,
    `На контроле: ${stats.on_control}`,
    `Устранено: ${stats.fixed}`,
  ]);
  doc.moveDown(0.6);

  // Диаграмма: категории
  doc.fontSize(14).text("Распределение по категориям");
  doc.moveDown(0.2);
  doc.image(
    Buffer.isBuffer(pieCat) ? pieCat : Buffer.from(pieCat),
    { fit: [520, 250], align: "center" },
  );
  doc.addPage();

  // Диаграмма: критичность
  doc.fontSize(14).text("Распределение по критичности");
  doc.moveDown(0.2);
  doc.image(
    Buffer.isBuffer(barSev) ? barSev : Buffer.from(barSev),
    { fit: [520, 250], align: "center" },
  );
  doc.addPage();

  // Коллаж критичных
  doc.fontSize(14).text("Критичные кейсы");
  doc.moveDown(0.3);

  const cols = 3;
  const cellW = 170;
  const cellH = 120;
  const cellPad = 12;
  let x = doc.x,
    y = doc.y;

  for (let i = 0; i < topCritical.length; i++) {
    const item = topCritical[i];

    let buf: Buffer | null = null;
    if (item.photoFileId) {
      try {
        // getFileLink -> URL -> ArrayBuffer -> Buffer
        const link = await (ctx as any).telegram.getFileLink(item.photoFileId);
        const res = await (globalThis.fetch as any)(link.toString());
        const arr = await res.arrayBuffer();
        buf = Buffer.from(arr);
      } catch {
        // плейсхолдер ниже
      }
    }

    const col = i % cols;
    if (col === 0 && i > 0) {
      y += cellH + cellPad + 30;
      x = (doc as any).page.margins.left;
      if (
        y + cellH + 60 >
        (doc as any).page.height - (doc as any).page.margins.bottom
      ) {
        doc.addPage();
        y = (doc as any).page.margins.top;
      }
    } else if (i === 0) {
      x = (doc as any).page.margins.left;
    }

    const cx = x + col * (cellW + cellPad);
    if (buf) {
      doc.image(buf, cx, y, {
        width: cellW,
        height: cellH,
        fit: [cellW, cellH],
      });
    } else {
      doc.rect(cx, y, cellW, cellH).stroke();
      doc.fontSize(10).text("нет фото", cx + 10, y + cellH / 2 - 6);
    }
    doc
      .fontSize(10)
      .text(
        `#${item.humanId} • ${item.object ?? ""} • ${fmtDate(
          new Date(item.createdAt),
        )}`,
        cx,
        y + cellH + 4,
        { width: cellW, align: "left" },
      );
  }

  doc.end();
  return await done;
}

export async function generateReportExcel(period: Period): Promise<Buffer> {
  const stats = await getReportStats(period.from, period.to);
  const byCat = await getReportByCategory(period.from, period.to);
  const bySev = await getReportBySeverity(period.from, period.to);
  const topCritical = await getTopCriticalDefects(period.from, period.to, 20);

  const wb = new ExcelJS.Workbook();

  // Сводка
  const summary = wb.addWorksheet("Сводка");
  summary.addRow(["Период", `${fmtDate(period.from)} — ${fmtDate(period.to)}`]);
  summary.addRow([]);
  summary.addRow(["Показатель", "Значение"]);
  summary.addRow(["Обнаружено", stats.discovered]);
  summary.addRow(["На контроле", stats.on_control]);
  summary.addRow(["Устранено", stats.fixed]);

  // Категории
  const wsCat = wb.addWorksheet("По категориям");
  wsCat.addRow(["Категория", "Кол-во"]);
  byCat.forEach((r) => wsCat.addRow([r.category ?? "—", r.count]));

  // Критичность
  const wsSev = wb.addWorksheet("По критичности");
  wsSev.addRow(["Критичность", "Кол-во"]);
  bySev.forEach((r) => wsSev.addRow([r.severity ?? "—", r.count]));

  // Топ критичных
  const wsTop = wb.addWorksheet("Критичные кейсы");
  wsTop.addRow(["Human ID", "Объект", "Создан", "Статус"]);
  topCritical.forEach((r) =>
    wsTop.addRow([
      r.humanId,
      r.object ?? "",
      fmtDate(new Date(r.createdAt)),
      r.status,
    ]),
  );

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
