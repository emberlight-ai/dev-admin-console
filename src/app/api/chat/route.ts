import { NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_GEMINI_MODELS,
  generateGeminiContent,
  type AllowedGeminiModel,
} from '@/lib/gemini';
import { buildTranscript } from '@/lib/botProfile';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { systemPrompt, history, message, model, mode, instruction } = body;

    // mode: 'chat' (default) | 'greeting' | 'followup'
    const currentMode = (mode === 'greeting' || mode === 'followup') ? mode : 'chat';

    // For greeting, we don't need a user message (it's a system trigger).
    if (currentMode === 'chat' && !message) {
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

    // Unified Digital Human Logic
    let finalPrompt = '';

    if (currentMode === 'greeting') {
      // GREETING MODE:
      // Ignore history. 
      // Prompt = System Prompt (Profile) + [System: instruction]
      // Matches `digital-human-greetings.ts`
      const greetingPrompt = instruction || 'Send a short friendly greeting to start the conversation.';
      const triggerMsg = `[System: ${greetingPrompt}]`;
      
      // We assume systemPrompt contains the full Bot+User profile text already composed by the frontend/caller.
      finalPrompt = `${systemPrompt}\n\n${triggerMsg}`;

    } else if (currentMode === 'followup') {
      // FOLLOWUP MODE:
      // Build transcript from history.
      // Prompt = System Prompt + Transcript + Instruction + "Reply as bot"
      // Matches `digital-human-followups.ts`

      const cleanHistory = (Array.isArray(history) ? history : []) as {
        role: string;
        parts: { text: string }[];
      }[];

      const transcriptMessages = cleanHistory.map((m) => ({
        sender_id: m.role === 'model' ? 'bot' : 'user',
        content: m.parts[0]?.text || '',
      }));
      
      const transcript = buildTranscript(transcriptMessages, 'bot', 'Bot');
      
      const followUpInstruction = instruction || 'Send a casual follow-up message to re-engage the conversation.';
      
      finalPrompt = `${systemPrompt}\n\nConversation so far:\n${transcript}\n\nThe user hasn't replied in a while.\nInstruction: ${followUpInstruction}\n\nWrite the follow-up as the bot. Reply with only the message text.`;

    } else {
      // CHAT MODE (Default):
      // Build transcript + latest user message.
      const cleanHistory = (Array.isArray(history) ? history : []) as {
        role: string;
        parts: { text: string }[];
      }[];

      const transcriptMessages = cleanHistory.map((m) => ({
        sender_id: m.role === 'model' ? 'bot' : 'user',
        content: m.parts[0]?.text || '',
      }));

      // Add the latest user message
      transcriptMessages.push({
        sender_id: 'user',
        content: message,
      });

      const transcript = buildTranscript(transcriptMessages, 'bot', 'Bot');

      finalPrompt = `${systemPrompt}\n\nConversation so far:\n${transcript}\n\nWrite the next message as the bot. Reply with only the message text.`;
    }

    const responseText = await generateGeminiContent(finalPrompt, modelName);

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
