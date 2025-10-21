import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";
import { URL } from "url";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key",
});

// Google Gemini client for native image generation
const geminiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GEMINI || "default_key",
});

export interface InspectionResult {
  defects: Array<{
    type: string;
    severity: "низкая" | "средняя" | "высокая";
    description: string;
    location: string;
    cause: string;
    consequences: string;
    recommendation: string;
  }>;
  positiveAspects: string[];
  summary: string;
  recommendations: string[];
}

export interface DesignResult {
  description: string;
  styleElements: string[];
  colorPalette: string[];
  recommendations: string[];
  imageUrl?: string;
}

export async function analyzeConstructionImage(imageUrl: string): Promise<InspectionResult> {
  try {
    console.log("🔍 === INSPECTOR ANALYSIS STARTED ===");
    console.log("📷 Analyzing image URL:", imageUrl);
    console.log("🤖 Using model: gpt-4o");
    console.log("📝 Sending detailed analysis prompt...");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "Вы эксперт по строительству и ремонту. Анализируйте фотографии ремонта/строительства и находите дефекты. Отвечайте только JSON.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Внимательно осмотрите это фото ремонта. Найдите ВСЕ видимые проблемы и дефекты:\n\n- Трещины, пятна, протечки\n- Неровные поверхности\n- Плохая покраска/штукатурка\n- Электрика/сантехника\n- Общее состояние\n\nДля каждого дефекта опишите: где находится, в чем проблема, как исправить.\n\nОТВЕТ СТРОГО в JSON формате:\n\n{\n  \"defects\": [\n    {\n      \"type\": \"название дефекта\",\n      \"severity\": \"высокая\",\n      \"description\": \"подробное описание\",\n      \"location\": \"где именно\",\n      \"cause\": \"причина\",\n      \"consequences\": \"чем грозит\",\n      \"recommendation\": \"как исправить\"\n    }\n  ],\n  \"positiveAspects\": [\"что сделано хорошо\"],\n  \"summary\": \"общий вывод\",\n  \"recommendations\": [\"общие рекомендации\"]\n}",
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
    });

    console.log("✅ OpenAI response received");
    console.log("📋 Raw response content:");
    console.log(response.choices[0].message.content);

    const result = JSON.parse(response.choices[0].message.content || "{}");
    console.log("🔍 Parsed JSON result:");
    console.log("  - Defects found:", result.defects?.length || 0);
    console.log("  - Positive aspects:", result.positiveAspects?.length || 0);
    console.log("  - Summary:", result.summary || "No summary");
    console.log("  - Recommendations:", result.recommendations?.length || 0);

    const finalResult = {
      defects: result.defects || [],
      positiveAspects: result.positiveAspects || [],
      summary: result.summary || "Анализ завершен",
      recommendations: result.recommendations || [],
    };

    console.log("🔍 === INSPECTOR ANALYSIS COMPLETED ===");
    return finalResult;
  } catch (error) {
    console.error("❌ Error analyzing construction image:", error);
    console.error("❌ Error details:", JSON.stringify(error, null, 2));
    throw new Error("Ошибка при анализе изображения");
  }
}

// URL validation to prevent SSRF attacks
function validateImageUrl(url: string): void {
  try {
    const parsedUrl = new URL(url);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Only HTTP and HTTPS protocols are allowed");
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      throw new Error("Access to localhost is not allowed");
    }

    if (hostname.match(/^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./)) {
      throw new Error("Access to private IP ranges is not allowed");
    }

    if (hostname.match(/^169\.254\.|^0\.|^224\.|^240\./)) {
      throw new Error("Access to internal IP addresses is not allowed");
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Invalid URL format");
    }
    throw error;
  }
}

// Native Gemini image generation function
async function generateImageWithNativeGemini(imageUrl: string, transformationPrompt: string): Promise<string | undefined> {
  try {
    console.log("🔧 Using native Google Gemini 2.0 Flash Preview Image Editing");
    console.log("📥 Downloading original image...");

    validateImageUrl(imageUrl);

    const downloadTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Image download timeout after 30 seconds")), 30000);
    });

    const imageResponse = await Promise.race([fetch(imageUrl), downloadTimeout]);

    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBytes = new Uint8Array(imageBuffer);
    console.log("✅ Image downloaded, size:", imageBytes.length, "bytes");

    if (imageBytes.length > 20 * 1024 * 1024) {
      throw new Error("Image too large: maximum 20MB allowed");
    }

    console.log("📋 Sending image editing request to native Gemini API...");
    const response = await geminiClient.models.generateContent({
      model: "gemini-2.0-flash-preview-image-generation",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: Buffer.from(imageBytes).toString("base64"),
                mimeType: "image/jpeg",
              },
            },
            {
              text: `EDIT THIS IMAGE: ${transformationPrompt}. Important: This is an IMAGE EDITING task - transform the existing room by changing furniture, colors, and decor while keeping the same architectural structure and layout. Generate an edited version of this exact room.`,
            },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    console.log("📋 Native Gemini response received");

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      console.log("⚠️ No candidates in Gemini response");
      return undefined;
    }

    const content = candidates[0].content;
    if (!content || !content.parts) {
      console.log("⚠️ No content parts in Gemini response");
      return undefined;
    }

    for (const part of content.parts) {
      if (part.text) {
        console.log("📝 Gemini text response:", part.text);
      } else if ((part as any).inlineData && (part as any).inlineData.data) {
        const base64Data = (part as any).inlineData.data;
        const imageDataUrl = `data:image/png;base64,${base64Data}`;
        console.log("✅ Image generated successfully with native Gemini API (base64 format)");
        console.log("📏 Base64 length:", base64Data.length);
        return imageDataUrl;
      }
    }

    console.log("⚠️ No image data found in native Gemini response");
    return undefined;
  } catch (error) {
    console.error("❌ Error with native Gemini API:", error);
    throw error;
  }
}

export function formatInspectionReport(result: InspectionResult): string {
  let report = "";

  if (result.defects.length > 0) {
    report += "🔍 **ДЕФЕКТЫ ОБНАРУЖЕНЫ:**\n\n";

    result.defects.forEach((defect, index) => {
      const severityEmoji = defect.severity === "высокая" ? "🔴" : defect.severity === "средняя" ? "🟡" : "🟢";

      report += `${index + 1}. ${severityEmoji} **${defect.type}** (${defect.severity})\n`;
      report += `📍 *Расположение:* ${defect.location}\n`;
      report += `🔎 *Описание:* ${defect.description}\n`;
      report += `⚠️ *Причина:* ${defect.cause}\n`;
      report += `💥 *Последствия:* ${defect.consequences}\n`;
      report += `🛠 *Рекомендация:* ${defect.recommendation}\n\n`;
    });
  } else {
    report += "✅ **ДЕФЕКТОВ НЕ ОБНАРУЖЕНО**\n\n";
  }

  if (result.positiveAspects.length > 0) {
    report += "👍 **ЧТО СДЕЛАНО ХОРОШО:**\n";
    result.positiveAspects.forEach((aspect) => {
      report += `• ${aspect}\n`;
    });
    report += "\n";
  }

  report += `📋 **ОБЩИЙ ВЫВОД:**\n${result.summary}\n\n`;

  if (result.recommendations.length > 0) {
    report += "💡 **РЕКОМЕНДАЦИИ:**\n";
    result.recommendations.forEach((rec) => {
      report += `• ${rec}\n`;
    });
    report += "\n";
  }

  return report;
}

export function formatDesignReport(result: DesignResult): string {
  let report = "";

  report += `🎨 **ДИЗАЙН-КОНЦЕПЦИЯ:**\n${result.description}\n\n`;

  if (result.styleElements.length > 0) {
    report += "✨ **ЭЛЕМЕНТЫ СТИЛЯ:**\n";
    result.styleElements.forEach((element) => {
      report += `• ${element}\n`;
    });
    report += "\n";
  }

  if (result.colorPalette.length > 0) {
    report += "🎨 **ЦВЕТОВАЯ ПАЛИТРА:**\n";
    result.colorPalette.forEach((color) => {
      report += `• ${color}\n`;
    });
    report += "\n";
  }

  if (result.recommendations.length > 0) {
    report += "💡 **РЕКОМЕНДАЦИИ:**\n";
    result.recommendations.forEach((rec) => {
      report += `• ${rec}\n`;
    });
    report += "\n";
  }

  return report;
}

// ===== POLZA helpers =====
const POLZA_BASE = process.env.POLZA_API_BASE || "https://api.polza.ai/api/v1";
const POLZA_KEY = process.env.POLZA_AI_API_KEY;

function ensurePolzaEnv() {
  if (!POLZA_KEY) throw new Error("POLZA_AI_API_KEY is not set");
}

async function polzaFetch(path: string, init: RequestInit, timeoutMs = 30000): Promise<Response> {
  ensurePolzaEnv();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${POLZA_KEY}`,
      ...(init.headers as Record<string, string> | undefined),
    };

    // Ставим JSON только когда тело — строка (для FormData не трогаем)
    if (typeof (init as any).body === "string" && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    return await fetch(`${POLZA_BASE}${path}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function toImageBase64(url: string, maxBytes = 20 * 1024 * 1024): Promise<{ mime: string; b64: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) return null;
    return { mime: ct.split(";")[0], b64: buf.toString("base64") };
  } catch {
    return null;
  }
}

function extractResultUrlStrict(payload: any): string | undefined {
  if (payload?.result?.images?.[0]?.url) return payload.result.images[0].url;
  if (payload?.images?.[0]?.url) return payload.images[0].url;
  if (typeof payload?.resultUrl === "string") return payload.resultUrl;
  if (typeof payload?.url === "string") return payload.url;
  const out = payload?.output;
  if (Array.isArray(out)) {
    if (typeof out[0] === "string") return out[0];
    if (out[0]?.url) return out[0].url;
  }
  return undefined;
}

let __modelsCache: any[] | null = null;
async function listPolzaModels(): Promise<any[]> {
  if (__modelsCache) return __modelsCache;
  const r = await polzaFetch("/models", { method: "GET" }, 20000);
  if (!r.ok) throw new Error(`Polza /models ${r.status}: ${await r.text().catch(() => r.statusText)}`);
  const j = await r.json();
  const models = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
  __modelsCache = models;
  return models;
}

async function pickNanoBananaModel(): Promise<string> {
  const models = await listPolzaModels();
  const envName = process.env.POLZA_IMAGE_MODEL?.trim();
  const idOf = (m: any) => m?.id || m?.name || m?.model || "";

  if (envName && models.some((m) => idOf(m) === envName)) return envName;

  const want = models.find((m) => /nano|banana|gemini.*2\.5.*image|flash.*image/i.test(idOf(m)));
  if (want) return idOf(want);

  const imageCap = models.find((m) => {
    const t = (m?.type || m?.category || "").toString().toLowerCase();
    const caps = JSON.stringify(m?.capabilities ?? m?.modes ?? m?.tags ?? "").toLowerCase();
    return t.includes("image") || caps.includes("image");
  });
  if (imageCap) return idOf(imageCap);

  throw new Error("В Polza не найдено ни одной модели для изображений. Проверь /models в своём аккаунте.");
}

function extractResultUrl(payload: any): string | undefined {
  if (!payload) return;
  if (typeof payload.resultUrl === "string") return payload.resultUrl;
  if (typeof payload.url === "string") return payload.url;
  if (payload?.result?.images?.[0]?.url) return payload.result.images[0].url;
  if (payload?.images?.[0]?.url) return payload.images[0].url;
  const out = payload?.output;
  if (Array.isArray(out)) {
    if (typeof out[0] === "string") return out[0];
    if (out[0]?.url) return out[0].url;
  }
  return;
}

function extractErrorMessage(data: any): string {
  return (
    data?.error?.message ||
    data?.error?.description ||
    data?.error?.code ||
    data?.message ||
    data?.result?.error ||
    (Array.isArray(data?.errors) && data.errors[0]?.message) ||
    (Array.isArray(data?.details) && data.details[0]?.message) ||
    (typeof data === "string" ? data : "") ||
    "unknown error"
  );
}

async function tryDownloadToBase64(url: string, timeoutMs = 30000): Promise<{ mime: string; b64: string } | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) return null;
    const b64 = buf.toString("base64");
    return { mime: ct.split(";")[0], b64 };
  } catch {
    return null;
  }
}

// ===== Полза: создание + корректный поллинг статуса =====
export async function generateImageWithPolza(
  imageUrl: string,
  style: string,
  accent: string | undefined,
  transformationPrompt: string
): Promise<string | undefined> {
  ensurePolzaEnv();

  const model = (process.env.POLZA_IMAGE_MODEL || "nano-banana").trim();

  const prompt = [
    `Restyle this EXACT room to "${style}".`,
    accent ? `Add accent: ${accent}.` : "",
    "Keep the same camera, layout, wall geometry and window positions.",
    "Do NOT add or remove walls, change perspective/camera, or move windows.",
    transformationPrompt,
  ].join(" ");

  const inline = await toImageBase64(imageUrl);

  const body: Record<string, any> = {
    model,
    prompt,
    ...(inline
      ? { files: [{ name: "source.jpg", mime: inline.mime, b64: inline.b64 }] }
      : { filesUrl: [imageUrl] }),
    image_strength: 0.25,
    // keep_structure: true,
    // negative_prompt: "new room, different layout, move windows, change camera",
  };

  const dbg = { ...body };
  if (dbg.files?.[0]?.b64) dbg.files[0].b64 = "<omitted>";
  console.log("Polza payload:", JSON.stringify(dbg, null, 2));

  const create = await polzaFetch("/images/generations", {
    method: "POST",
    body: JSON.stringify(body),
  }, 30000);

  const createText = !create.ok ? await create.text().catch(() => "") : "";
  if (!create.ok) {
    throw new Error(`Polza create ${create.status}: ${createText || create.statusText}`);
  }

  const createJson = (await create.json()) as { id?: string; requestId?: string };
  const id = createJson.id || createJson.requestId;
  if (!id) throw new Error("Polza: в ответе создания нет id/requestId");

  const started = Date.now();
  const MAX_WAIT = 120_000;
  const SLEEP = 1500;

  while (Date.now() - started < MAX_WAIT) {
    const st = await polzaFetch(`/images/${encodeURIComponent(id)}`, { method: "GET" }, 20000);
    const txt = !st.ok ? await st.text().catch(() => "") : "";
    const data = st.ok ? await st.json().catch(() => null) : null;

    if (!st.ok) {
      if (st.status === 404) {
        const alt = await polzaFetch(`/images/generations/${encodeURIComponent(id)}`, { method: "GET" }, 20000);
        const altTxt = !alt.ok ? await alt.text().catch(() => "") : "";
        const altData = alt.ok ? await alt.json().catch(() => null) : null;
        if (!alt.ok) throw new Error(`Polza status ${alt.status}: ${altTxt || "unknown error"}`);
        const status = String(altData?.status || "").toUpperCase();
        if (["SUCCEEDED", "SUCCESS", "DONE", "COMPLETED"].includes(status)) {
          const url = extractResultUrlStrict(altData) || extractResultUrlStrict(altData?.result);
          if (!url) throw new Error(`Polza success but no URL: ${JSON.stringify(altData).slice(0, 800)}`);
          return url;
        }
        if (["FAILED", "ERROR"].includes(status)) {
          throw new Error(`Polza generation failed: ${JSON.stringify(altData).slice(0, 800)}`);
        }
        await new Promise((r) => setTimeout(r, SLEEP));
        continue;
      }
      throw new Error(`Polza status ${st.status}: ${txt || "unknown error"}`);
    }

    const status = String(data?.status || "").toUpperCase();

    if (["SUCCEEDED", "SUCCESS", "DONE", "COMPLETED"].includes(status)) {
      const url = extractResultUrlStrict(data) || extractResultUrlStrict(data?.result);
      if (!url) throw new Error(`Polza success but no URL: ${JSON.stringify(data).slice(0, 800)}`);
      return url;
    }
    if (["FAILED", "ERROR"].includes(status)) {
      throw new Error(`Polza generation failed: ${JSON.stringify(data).slice(0, 800)}`);
    }

    await new Promise((r) => setTimeout(r, SLEEP));
  }

  throw new Error("Polza: истек таймаут ожидания результата");
}

// ===== основная функция (Polza как основной путь) =====
export async function generateDesignConcept(
  imageUrl: string,
  style: string,
  priority: string,
  accent: string,
  model: string = "gpt-image-1"
): Promise<DesignResult> {
  try {
    validateImageUrl(imageUrl);
    const transformationPrompt =
      `Transform this room to ${style} style with ${accent || "no"} accents. ` +
      `Keep layout; change furniture & colors to match ${style}. ` +
      `Priority: ${priority}. Use realistic materials, consistent lighting, correct perspective.`;

    console.log("🚀 Using Polza (Nano-Banana) …");
    const generatedImageUrl = await generateImageWithPolza(imageUrl, style, accent, transformationPrompt);

    return {
      description: `Дизайн-концепция в стиле ${style} с акцентом на ${accent}`,
      styleElements: [`Стиль: ${style}`, `Приоритет: ${priority}`, `Акцент: ${accent}`],
      colorPalette: [`Цветовая схема для стиля ${style}`],
      recommendations: [`Применён стиль ${style}`, `Учтён приоритет: ${priority}`, `Добавлены акценты: ${accent}`],
      imageUrl: generatedImageUrl,
    };
  } catch (err: any) {
    console.error("Designer (Polza) error:", err);
    return {
      description: `Дизайн-концепция в стиле ${style} (без изображения: ${String(err?.message || err)})`,
      styleElements: [`Стиль: ${style}`, `Приоритет: ${priority}`, `Акцент: ${accent}`],
      colorPalette: [`Цветовая схема для стиля ${style}`],
      recommendations: [`Применён стиль ${style}`, `Учтён приоритет: ${priority}`, `Добавлены акценты: ${accent}`],
      imageUrl: undefined,
    };
  }
}
