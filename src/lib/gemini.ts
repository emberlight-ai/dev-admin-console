import {
  GoogleGenAI,
  type Part,
  type GenerateContentResponse,
  type GenerateContentConfig,
  HarmCategory,
  HarmBlockThreshold,
  ThinkingLevel,
} from '@google/genai';
import {
  controlledGenerationConfig,
  DEFAULT_REPLY_MODEL,
  vertexOptions,
} from '../../supabase/functions/_shared/vertex-config';

// Lazy initialization keeps builds independent of deployment credentials.
let vertexAI: GoogleGenAI | undefined;
function client() {
  return vertexAI ??= new GoogleGenAI(vertexOptions((name) => process.env[name]));
}

function responseText(response: GenerateContentResponse): string {
  const text = response.text?.trim() || response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '').join('').trim();
  if (!text) throw new Error(`Vertex returned no text (${response.promptFeedback?.blockReason ?? response.candidates?.[0]?.finishReason ?? 'empty response'}).`);
  return text;
}

export const ALLOWED_GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
] as const;

export type AllowedGeminiModel = (typeof ALLOWED_GEMINI_MODELS)[number];

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

function generationConfig(model: string): GenerateContentConfig {
  const controlled = controlledGenerationConfig(model);
  const config: GenerateContentConfig = {
    maxOutputTokens: controlled.maxOutputTokens,
    automaticContinuation: controlled.automaticContinuation,
  };
  if (controlled.thinkingConfig) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  return config;
}

export async function getGeminiResponse(
  systemPrompt: string,
  messageHistory: { role: 'user' | 'model'; parts: { text: string }[] }[],
  userMessage: string,
  modelName: AllowedGeminiModel = DEFAULT_REPLY_MODEL
) {
  const chat = client().chats.create({
    model: modelName,
    history: messageHistory,
    config: {
      ...generationConfig(modelName),
      systemInstruction: systemPrompt,
      safetySettings,
    },
  });

  const result = await chat.sendMessage({ message: userMessage });
  return responseText(result);
}

export async function generateGeminiContent(
  prompt: string | (string | Part)[],
  modelName: AllowedGeminiModel = DEFAULT_REPLY_MODEL
) {
  const parts: Part[] = typeof prompt === 'string'
    ? [{ text: prompt }]
    : prompt.map((part) => typeof part === 'string' ? { text: part } : part);
  const result = await client().models.generateContent({
    model: modelName,
    contents: [{ role: 'user', parts }],
    config: {
      ...generationConfig(modelName),
      safetySettings,
    },
  });
  return responseText(result);
}
