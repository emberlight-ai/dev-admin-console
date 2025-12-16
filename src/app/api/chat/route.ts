import { NextRequest, NextResponse } from 'next/server';
import { getGeminiResponse } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { systemPrompt, history, message } = body;

    if (!systemPrompt || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: systemPrompt, message' },
        { status: 400 }
      );
    }

    const responseText = await getGeminiResponse(systemPrompt, history || [], message);

    return NextResponse.json({ response: responseText });
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate response', details: error.message },
      { status: 500 }
    );
  }
}

