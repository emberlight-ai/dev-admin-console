// @ts-nocheck
// Shared clients for the DH edge functions: one supabase handle, the two
// Vertex models (utility + reply with graceful fallback), and safety settings.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  ThinkingLevel,
} from 'npm:@google/genai@2.32.0';
import {
  controlledGenerationConfig,
  vertexOptions,
  utilityModelName,
  replyModelName,
} from './vertex-config.ts';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const vertexAI = new GoogleGenAI(vertexOptions((name) => Deno.env.get(name)));

export const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export const utilityModelId = utilityModelName((name) => Deno.env.get(name));
export const replyModelId = replyModelName((name) => Deno.env.get(name));

function configFor(model: string, generationConfig: Record<string, unknown> = {}) {
  const controlled = controlledGenerationConfig(model);
  return {
    ...controlled,
    ...(controlled.thinkingConfig
      ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
      : {}),
    safetySettings,
    ...generationConfig,
  };
}

async function generateContent(model: string, request: Record<string, any>) {
  const {
    contents,
    systemInstruction,
    generationConfig = {},
    tools,
    toolConfig,
  } = request;
  return await vertexAI.models.generateContent({
    model,
    contents,
    config: {
      ...configFor(model, generationConfig),
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(tools ? { tools } : {}),
      ...(toolConfig ? { toolConfig } : {}),
    },
  });
}

export async function generateUtilityContent(request: Record<string, unknown>) {
  return await generateContent(utilityModelId, request);
}

// A bad reply-model id degrades gracefully instead of breaking production.
export async function generateWithFallback(tag: string, request: Record<string, unknown>) {
  try {
    return await generateContent(replyModelId, request);
  } catch (err) {
    console.error(`[${tag}] reply model failed; falling back to utility model`, err);
    return await generateContent(utilityModelId, request);
  }
}
