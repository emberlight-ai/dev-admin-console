// @ts-nocheck
// The agent turn loop: model ⇄ tools, bounded iterations, then bubbles out.
// JSON response mode can't combine with function calling, so bubbles are the
// final text split on blank lines; the CALLER applies hard caps (e.g. the
// shortUser one-bubble rule).
import { generateWithFallback } from './clients.ts';
import type { ToolEvent } from './tools.ts';

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const MAX_ITERATIONS = 3;

function splitBubbles(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .slice(0, 3);
}

export async function runAgentTurn(input: {
  systemInstruction: string;
  userPrompt: string;
  declarations: Array<Record<string, unknown>>;
  execute: ToolExecutor;
  tag: string;
}): Promise<{ bubbles: string[]; toolEvents: ToolEvent[] }> {
  const contents: Array<Record<string, unknown>> = [
    { role: 'user', parts: [{ text: input.userPrompt }] },
  ];
  const toolEvents: ToolEvent[] = [];
  const request: Record<string, unknown> = {
    systemInstruction: { role: 'system', parts: [{ text: input.systemInstruction }] },
    contents,
    ...(input.declarations.length
      ? { tools: [{ functionDeclarations: input.declarations }] }
      : {}),
  };

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const result = await generateWithFallback(input.tag, request);
    const respData = await result.response;
    const parts: Array<Record<string, unknown>> =
      respData?.candidates?.[0]?.content?.parts ?? [];

    const functionCalls = parts.filter((p) => p.functionCall);
    if (functionCalls.length === 0 || iteration === MAX_ITERATIONS - 1) {
      const text = parts
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('')
        .trim();
      return { bubbles: splitBubbles(text), toolEvents };
    }

    // Echo the model turn, execute each call, and feed results back.
    contents.push({ role: 'model', parts });
    const responseParts: Array<Record<string, unknown>> = [];
    for (const p of functionCalls) {
      const call = p.functionCall as { name: string; args?: Record<string, unknown> };
      const started = Date.now();
      let response: unknown;
      let ok = true;
      try {
        response = await input.execute(call.name, call.args ?? {});
      } catch (err) {
        ok = false;
        response = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      toolEvents.push({ name: call.name, args: call.args ?? {}, ok, ms: Date.now() - started });
      responseParts.push({
        functionResponse: { name: call.name, response: { result: response } },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { bubbles: [], toolEvents };
}
