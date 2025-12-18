import { NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_GEMINI_MODELS,
  getGeminiResponse,
  type AllowedGeminiModel,
} from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { systemPrompt, history, message, model } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Missing required field: message' },
        { status: 400 }
      );
    }

    const requested = (
      typeof model === 'string' ? model : 'gemini-2.5-flash'
    ) as string;
    const modelName: AllowedGeminiModel = (
      ALLOWED_GEMINI_MODELS as readonly string[]
    ).includes(requested)
      ? (requested as AllowedGeminiModel)
      : 'gemini-2.5-flash';

    const responseText = await getGeminiResponse(
      typeof systemPrompt === 'string' ? systemPrompt : '',
      history || [],
      message,
      modelName
    );

    return NextResponse.json({ response: responseText });
  } catch (error: unknown) {
    console.error('Gemini API Error:', error);
    const details =
      error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : undefined;
    return NextResponse.json(
      { error: 'Failed to generate response', details },
      { status: 500 }
    );
  }
}
