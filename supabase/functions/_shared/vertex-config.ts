// Shared by the Next.js server and Supabase functions; no runtime-specific APIs.
export const VERTEX_PROJECT_ID = 'the-method-392512';
export const DEFAULT_UTILITY_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_REPLY_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_MAX_OUTPUT_TOKENS = 256;

export function controlledGenerationConfig(
  model: string,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS
) {
  const generationConfig: {
    maxOutputTokens: number;
    automaticContinuation: false;
    thinkingConfig?: { thinkingLevel: 'MINIMAL' };
  } = { maxOutputTokens, automaticContinuation: false };

  // Gemini 3 uses a thinking level rather than a numeric thinking budget.
  // MINIMAL is enough for short chat replies and avoids paying for long hidden
  // reasoning traces that the user never sees.
  if (/^gemini-3(?:\.|-|$)/.test(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' };
  }

  return generationConfig;
}

export function vertexOptions(read: (name: string) => string | undefined) {
  const project = read('GOOGLE_CLOUD_PROJECT_ID') || VERTEX_PROJECT_ID;
  if (project !== VERTEX_PROJECT_ID) {
    throw new Error(`AI must use Vertex project ${VERTEX_PROJECT_ID}; check GOOGLE_CLOUD_PROJECT_ID.`);
  }
  const clientEmail = read('GOOGLE_CLIENT_EMAIL');
  const privateKey = read('GOOGLE_PRIVATE_KEY');
  if (Boolean(clientEmail) !== Boolean(privateKey)) {
    throw new Error('Set both GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY, or use Application Default Credentials.');
  }
  return {
    vertexai: true as const,
    project,
    location: read('GOOGLE_CLOUD_LOCATION') || 'global',
    ...(clientEmail && privateKey ? {
      googleAuthOptions: {
        credentials: {
          client_email: clientEmail,
          private_key: privateKey.replace(/\\n/g, '\n'),
        },
      },
    } : {}),
  };
}

export function utilityModelName(read: (name: string) => string | undefined) {
  return read('AI_UTILITY_MODEL') || DEFAULT_UTILITY_MODEL;
}

export function replyModelName(read: (name: string) => string | undefined) {
  return read('AI_REPLY_MODEL') || DEFAULT_REPLY_MODEL;
}
