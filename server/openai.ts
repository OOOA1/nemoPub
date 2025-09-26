import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";
import { URL } from "url";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key"
});

// Laozhang.ai client for image generation
const laozhangClient = new OpenAI({
  apiKey: process.env.LAOZHANG_API_KEY || "default_key",
  baseURL: "https://api.laozhang.ai/v1"
});

// Google Gemini client for native image generation
const geminiClient = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || process.env.GEMINI || "default_key" 
});

export interface InspectionResult {
  defects: Array<{
    type: string;
    severity: 'низкая' | 'средняя' | 'высокая';
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
    console.log('🔍 === INSPECTOR ANALYSIS STARTED ===');
    console.log('📷 Analyzing image URL:', imageUrl);
    console.log('🤖 Using model: gpt-4o');
    console.log('📝 Sending detailed analysis prompt...');
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Вы эксперт по строительству и ремонту. Анализируйте фотографии ремонта/строительства и находите дефекты. Отвечайте только JSON."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Внимательно осмотрите это фото ремонта. Найдите ВСЕ видимые проблемы и дефекты:\n\n- Трещины, пятна, протечки\n- Неровные поверхности\n- Плохая покраска/штукатурка\n- Электрика/сантехника\n- Общее состояние\n\nДля каждого дефекта опишите: где находится, в чем проблема, как исправить.\n\nОТВЕТ СТРОГО в JSON формате:\n\n{\n  \"defects\": [\n    {\n      \"type\": \"название дефекта\",\n      \"severity\": \"высокая\",\n      \"description\": \"подробное описание\",\n      \"location\": \"где именно\",\n      \"cause\": \"причина\",\n      \"consequences\": \"чем грозит\",\n      \"recommendation\": \"как исправить\"\n    }\n  ],\n  \"positiveAspects\": [\"что сделано хорошо\"],\n  \"summary\": \"общий вывод\",\n  \"recommendations\": [\"общие рекомендации\"]\n}"
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500
    });

    console.log('✅ OpenAI response received');
    console.log('📋 Raw response content:');
    console.log(response.choices[0].message.content);
    
    const result = JSON.parse(response.choices[0].message.content || '{}');
    console.log('🔍 Parsed JSON result:');
    console.log('  - Defects found:', result.defects?.length || 0);
    console.log('  - Positive aspects:', result.positiveAspects?.length || 0);
    console.log('  - Summary:', result.summary || 'No summary');
    console.log('  - Recommendations:', result.recommendations?.length || 0);
    
    const finalResult = {
      defects: result.defects || [],
      positiveAspects: result.positiveAspects || [],
      summary: result.summary || 'Анализ завершен',
      recommendations: result.recommendations || []
    };
    
    console.log('🔍 === INSPECTOR ANALYSIS COMPLETED ===');
    return finalResult;
  } catch (error) {
    console.error('❌ Error analyzing construction image:', error);
    console.error('❌ Error details:', JSON.stringify(error, null, 2));
    throw new Error('Ошибка при анализе изображения');
  }
}

// URL validation to prevent SSRF attacks
function validateImageUrl(url: string): void {
  try {
    const parsedUrl = new URL(url);
    
    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only HTTP and HTTPS protocols are allowed');
    }
    
    // Block private IP ranges and localhost
    const hostname = parsedUrl.hostname.toLowerCase();
    
    // Block localhost variations
    if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      throw new Error('Access to localhost is not allowed');
    }
    
    // Block private IP ranges (simplified check for common ranges)
    if (hostname.match(/^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\./)) {
      throw new Error('Access to private IP ranges is not allowed');
    }
    
    // Block additional internal addresses
    if (hostname.match(/^169\.254\.|^0\.|^224\.|^240\./)) {
      throw new Error('Access to internal IP addresses is not allowed');
    }
    
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Invalid URL format');
    }
    throw error;
  }
}

export async function generateDesignConcept(
  imageUrl: string, 
  style: string, 
  priority: string, 
  accent: string,
  model: string = "gpt-image-1"
): Promise<DesignResult> {
  try {
    // Validate the image URL to prevent SSRF attacks
    validateImageUrl(imageUrl);
    console.log(`🎨 Starting image transformation with ${model}`);
    console.log('📷 Original image URL:', imageUrl);
    console.log('🎯 Style:', style, 'Priority:', priority, 'Accent:', accent);
    
    const transformationPrompt = `Transform this room to ${style} style with ${accent} accents. Keep same layout, change furniture and colors to match ${style} design.`;
    let generatedImageUrl: string | undefined;

    if (model === "gpt-image-1" || model === "polza-nano-banana") {
      // Use Polza Gemini via laozhang.ai
      if (!process.env.LAOZHANG_API_KEY) {
        throw new Error('LAOZHANG_API_KEY not found - Polza Gemini API required');
      }
      
      console.log(`🚀 Using Polza Gemini via laozhang.ai for ${model} model...`);
      
      try {
        generatedImageUrl = await generateImageWithLaozhangGemini(imageUrl, style, accent, transformationPrompt);
        
        if (generatedImageUrl) {
          console.log(`✅ SUCCESS: Polza Gemini generated image for ${model}`);
        }
      } catch (error: any) {
        console.log(`❌ Polza Gemini failed:`, error.message);
        throw new Error(`Polza Gemini API error: ${error.message}`);
      }

    } else if (model === "gemini-2.5-flash-image-preview") {
      // ONLY use native Gemini API - no fallback to laozhang  
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY not found - native Gemini API required');
      }
      
      console.log('🚀 Using NATIVE Google Gemini API with your secret key...');
      
      // Add timeout to prevent hanging requests (90 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout after 90 seconds')), 90000);
      });
      
      generatedImageUrl = await Promise.race([
        generateImageWithNativeGemini(imageUrl, transformationPrompt),
        timeoutPromise
      ]);
      
      if (!generatedImageUrl) {
        throw new Error('Native Gemini API failed to generate image');
      }
    }

    if (generatedImageUrl) {
      console.log('🖼️ Image format:', generatedImageUrl.startsWith('data:') ? 'base64' : 'URL');
      console.log('🖼️ Image size:', generatedImageUrl.length, 'characters');
    } else {
      console.log('❌ No generated image URL available');
    }

    return {
      description: `Дизайн-концепция в стиле ${style} с акцентом на ${accent}`,
      styleElements: [`${style} стиль`, `Приоритет: ${priority}`, `Акцент: ${accent}`],
      colorPalette: [`Цветовая схема ${style}`],
      recommendations: [`Применен стиль ${style}`, `Учтен приоритет ${priority}`, `Добавлены ${accent} акценты`],
      imageUrl: generatedImageUrl
    };
    
  } catch (error) {
    console.error(`Error with ${model}:`, error);
    
    // If quota is insufficient or invalid size, return concept without image
    if (error && typeof error === 'object' && 'code' in error && 
        (error.code === 'insufficient_quota' || error.code === 'invalid_value')) {
      console.log('⚠️ Quota insufficient, returning design concept without image');
      return {
        description: `Дизайн-концепция в стиле ${style} с акцентом на ${accent}`,
        styleElements: [`${style} стиль`, `Приоритет: ${priority}`, `Акцент: ${accent}`],
        colorPalette: [`Цветовая схема ${style}`],
        recommendations: [`Применен стиль ${style}`, `Учтен приоритет ${priority}`, `Добавлены ${accent} акценты`],
        imageUrl: undefined // No image due to quota limits
      };
    }
    
    throw new Error(`Ошибка при создании дизайн-проекта с ${model}`);
  }
}


// Native Gemini image generation function
async function generateImageWithNativeGemini(imageUrl: string, transformationPrompt: string): Promise<string | undefined> {
  try {
    console.log('🔧 Using native Google Gemini 2.0 Flash Preview Image Editing');
    console.log('📥 Downloading original image...');
    
    // Validate image URL before downloading
    validateImageUrl(imageUrl);
    
    // Add timeout for image download
    const downloadTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Image download timeout after 30 seconds')), 30000);
    });
    
    const imageResponse = await Promise.race([
      fetch(imageUrl),
      downloadTimeout
    ]);
    
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`);
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBytes = new Uint8Array(imageBuffer);
    console.log('✅ Image downloaded, size:', imageBytes.length, 'bytes');
    
    // Check image size limits (max 20MB)
    if (imageBytes.length > 20 * 1024 * 1024) {
      throw new Error('Image too large: maximum 20MB allowed');
    }

    console.log('📋 Sending image editing request to native Gemini API...');
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
              }
            },
            { 
              text: `EDIT THIS IMAGE: ${transformationPrompt}. Important: This is an IMAGE EDITING task - transform the existing room by changing furniture, colors, and decor while keeping the same architectural structure and layout. Generate an edited version of this exact room.`
            }
          ] 
        }
      ],
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    console.log('📋 Native Gemini response received');
    
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      console.log('⚠️ No candidates in Gemini response');
      return undefined;
    }

    const content = candidates[0].content;
    if (!content || !content.parts) {
      console.log('⚠️ No content parts in Gemini response');
      return undefined;
    }

    // Look for image data in response parts
    for (const part of content.parts) {
      if (part.text) {
        console.log('📝 Gemini text response:', part.text);
      } else if (part.inlineData && part.inlineData.data) {
        const base64Data = part.inlineData.data;
        const imageDataUrl = `data:image/png;base64,${base64Data}`;
        console.log('✅ Image generated successfully with native Gemini API (base64 format)');
        console.log('📏 Base64 length:', base64Data.length);
        return imageDataUrl;
      }
    }

    console.log('⚠️ No image data found in native Gemini response');
    return undefined;

  } catch (error) {
    console.error('❌ Error with native Gemini API:', error);
    throw error;
  }
}


// Laozhang Gemini fallback function  
async function generateImageWithLaozhangGemini(imageUrl: string, style: string, accent: string, transformationPrompt: string): Promise<string | undefined> {
  try {
    console.log('📋 Transformation prompt:', transformationPrompt);

    // Retry logic for rate limits
    let attempts = 0;
    const maxAttempts = 3;
    let response;

    while (attempts < maxAttempts) {
      try {
        console.log(`🚀 Calling laozhang chat completions with gemini-2.5-flash-image-preview (attempt ${attempts + 1})...`);
        
        response = await laozhangClient.chat.completions.create({
          model: "gemini-2.5-flash-image-preview",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text", 
                  text: `EDIT: Transform this room to ${style} style with ${accent} focus. Keep same layout but change furniture, colors, materials to match ${style} aesthetic.`
                },
                {
                  type: "image_url",
                  image_url: {
                    url: imageUrl
                  }
                }
              ]
            }
          ],
          max_tokens: 800
        });
        break; // Success, exit retry loop

      } catch (error: any) {
        attempts++;
        console.log(`❌ Attempt ${attempts} failed:`, error.message);

        if (error.status === 429 && attempts < maxAttempts) {
          const delay = Math.pow(2, attempts) * 1000; // Exponential backoff
          console.log(`⏳ Rate limit hit, waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        } else {
          throw error; // Re-throw if not recoverable or max attempts reached
        }
      }
    }

    if (response) {
      console.log('📋 gemini-2.5-flash-image-preview response received');
      console.log('🔍 Response status:', 'Success');
      console.log('🔍 Response content length:', response.choices?.[0]?.message?.content?.length || 0);
    } else {
      console.log('❌ No response received from gemini-2.5-flash-image-preview');
      throw new Error('No response from Gemini API');
    }
    
    // Check if response contains base64 image data
    const messageContent = response.choices?.[0]?.message?.content;
    if (messageContent) {
      // Look for base64 image data in the response
      const base64Match = messageContent.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
      if (base64Match) {
        console.log('✅ Image edited successfully with gemini-2.5-flash-image-preview (base64 format)');
        console.log('📏 Base64 length:', base64Match[1].length);
        return base64Match[0];
      } else {
        console.log('⚠️ No base64 image found in gemini response, checking for URL...');
        // Check for URL patterns
        const urlMatch = messageContent.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|webp)/i);
        if (urlMatch) {
          console.log('✅ Image URL found in gemini response');
          console.log('🔗 Image URL:', urlMatch[0]);
          return urlMatch[0];
        } else {
          console.log('⚠️ No image found in gemini-2.5-flash-image-preview response');
          console.log('📋 Response content preview:', messageContent.substring(0, 200) + '...');
        }
      }
    } else {
      console.log('⚠️ No content in gemini-2.5-flash-image-preview response');
    }
    
    return undefined;
    
  } catch (error) {
    console.error('❌ Error with laozhang Gemini API:', error);
    throw error;
  }
}

export function formatInspectionReport(result: InspectionResult): string {
  let report = '';
  
  if (result.defects.length > 0) {
    report += '🔍 **ДЕФЕКТЫ ОБНАРУЖЕНЫ:**\n\n';
    
    result.defects.forEach((defect, index) => {
      const severityEmoji = defect.severity === 'высокая' ? '🔴' : 
                           defect.severity === 'средняя' ? '🟡' : '🟢';
      
      report += `${index + 1}. ${severityEmoji} **${defect.type}** (${defect.severity})\n`;
      report += `📍 *Расположение:* ${defect.location}\n`;
      report += `🔎 *Описание:* ${defect.description}\n`;
      report += `⚠️ *Причина:* ${defect.cause}\n`;
      report += `💥 *Последствия:* ${defect.consequences}\n`;
      report += `🛠 *Рекомендация:* ${defect.recommendation}\n\n`;
    });
  } else {
    report += '✅ **ДЕФЕКТОВ НЕ ОБНАРУЖЕНО**\n\n';
  }
  
  if (result.positiveAspects.length > 0) {
    report += '👍 **ЧТО СДЕЛАНО ХОРОШО:**\n';
    result.positiveAspects.forEach(aspect => {
      report += `• ${aspect}\n`;
    });
    report += '\n';
  }
  
  report += `📋 **ОБЩИЙ ВЫВОД:**\n${result.summary}\n\n`;
  
  if (result.recommendations.length > 0) {
    report += '💡 **РЕКОМЕНДАЦИИ:**\n';
    result.recommendations.forEach(rec => {
      report += `• ${rec}\n`;
    });
    report += '\n';
  }
  
  return report;
}

export function formatDesignReport(result: DesignResult): string {
  let report = '';
  
  report += `🎨 **ДИЗАЙН-КОНЦЕПЦИЯ:**\n${result.description}\n\n`;
  
  if (result.styleElements.length > 0) {
    report += '✨ **ЭЛЕМЕНТЫ СТИЛЯ:**\n';
    result.styleElements.forEach(element => {
      report += `• ${element}\n`;
    });
    report += '\n';
  }
  
  if (result.colorPalette.length > 0) {
    report += '🎨 **ЦВЕТОВАЯ ПАЛИТРА:**\n';
    result.colorPalette.forEach(color => {
      report += `• ${color}\n`;
    });
    report += '\n';
  }
  
  if (result.recommendations.length > 0) {
    report += '💡 **РЕКОМЕНДАЦИИ:**\n';
    result.recommendations.forEach(rec => {
      report += `• ${rec}\n`;
    });
    report += '\n';
  }
  
  return report;
}