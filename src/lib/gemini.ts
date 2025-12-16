import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

const genAI = new GoogleGenerativeAI(apiKey);

// Using a model that is likely to work. The user requested "gemini 2.5 pro",
// but standard models are gemini-1.5-pro or gemini-pro.
// We will try to respect the intent or default to a working one.
const MODEL_NAME = 'gemini-2.5-pro';

export async function getGeminiResponse(
  systemPrompt: string,
  messageHistory: { role: 'user' | 'model'; parts: { text: string }[] }[],
  userMessage: string
) {
  const model = genAI.getGenerativeModel(
    {
      model: MODEL_NAME,
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
