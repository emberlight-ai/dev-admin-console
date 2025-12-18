import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

const genAI = new GoogleGenerativeAI(apiKey);

export const ALLOWED_GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const;

export type AllowedGeminiModel = (typeof ALLOWED_GEMINI_MODELS)[number];

export async function getGeminiResponse(
  systemPrompt: string,
  messageHistory: { role: 'user' | 'model'; parts: { text: string }[] }[],
  userMessage: string,
  modelName: AllowedGeminiModel = 'gemini-2.5-flash'
) {
  const model = genAI.getGenerativeModel(
    {
      model: modelName,
      systemInstruction: systemPrompt,
    },
    {
      baseUrl: baseUrl, // Optional if using a proxy/custom endpoint
    }
  );

  const chat = model.startChat({
    history: messageHistory,
  });

  const result = await chat.sendMessage(userMessage);
  const response = await result.response;
  return response.text();
}
