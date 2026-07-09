// @ts-nocheck
// Shared clients for the DH edge functions: one supabase handle, the two
// Vertex models (utility + reply with graceful fallback), and safety settings.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { VertexAI, HarmCategory, HarmBlockThreshold } from 'npm:@google-cloud/vertexai';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const project = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID') || 'YOUR_PROJECT_ID';
const location = Deno.env.get('GOOGLE_CLOUD_LOCATION') || 'global';
const clientEmail = Deno.env.get('GOOGLE_CLIENT_EMAIL');
const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

const vertexAI = new VertexAI({
  project,
  location,
  apiEndpoint: 'aiplatform.googleapis.com',
  ...(clientEmail && privateKey
    ? {
        googleAuthOptions: {
          credentials: {
            client_email: clientEmail,
            private_key: privateKey,
          },
        },
      }
    : {}),
});

export const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Utility model (cheap/fast): intimacy critic + image description.
export const utilityModel = vertexAI.getGenerativeModel({
  model: Deno.env.get('AI_INTEGRATIONS_GEMINI_MODEL') ?? 'gemini-3.1-flash-lite-preview',
  safetySettings,
});

// Reply model (higher quality): the user-facing message. Gemini 3 Pro follows
// long, nuanced persona prompts far better than flash-lite. Override via the
// AI_REPLY_MODEL secret.
export const replyModel = vertexAI.getGenerativeModel({
  model: Deno.env.get('AI_REPLY_MODEL') ?? 'gemini-3-pro-preview',
  safetySettings,
});

// Generate with the Pro model, falling back to the utility model if the
// configured reply model id is unavailable — a bad id degrades gracefully
// instead of breaking replies in production.
export async function generateWithFallback(tag: string, request: Record<string, unknown>) {
  try {
    return await replyModel.generateContent(request as any);
  } catch (err) {
    console.error(`[${tag}] reply model failed; falling back to utility model`, err);
    return await utilityModel.generateContent(request as any);
  }
}
