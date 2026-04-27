import type { NextRequest } from 'next/server';

type RouteHandler<TArgs extends [NextRequest, ...unknown[]]> = (
  ...args: TArgs
) => Response | Promise<Response>;

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
const BODYLESS_STATUSES = new Set([204, 304]);

function serializeFormValue(value: FormDataEntryValue) {
  if (value instanceof File) {
    return {
      type: 'file',
      name: value.name,
      contentType: value.type,
      size: value.size,
    };
  }

  return value;
}

function serializeFormData(form: FormData) {
  const body: Record<string, unknown> = {};

  for (const [key, value] of form.entries()) {
    const serializedValue = serializeFormValue(value);
    const existingValue = body[key];

    if (existingValue === undefined) {
      body[key] = serializedValue;
    } else if (Array.isArray(existingValue)) {
      existingValue.push(serializedValue);
    } else {
      body[key] = [existingValue, serializedValue];
    }
  }

  return body;
}

async function readBodyForLog(request: NextRequest): Promise<unknown> {
  if (BODYLESS_METHODS.has(request.method) || !request.body) {
    return null;
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  const clone = request.clone();

  try {
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      return await clone.json();
    }

    if (
      contentType.includes('multipart/form-data') ||
      contentType.includes('application/x-www-form-urlencoded')
    ) {
      const form = await clone.formData();
      return serializeFormData(form);
    }

    const text = await clone.text();
    return text.length > 0 ? text : null;
  } catch (error) {
    return {
      unreadable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readResponseForLog(response: Response): Promise<unknown> {
  if (BODYLESS_STATUSES.has(response.status) || !response.body) {
    return null;
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const clone = response.clone();

  try {
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      return await clone.json();
    }

    if (contentType.startsWith('text/')) {
      const text = await clone.text();
      return text.length > 0 ? text : null;
    }

    return {
      unlogged: true,
      reason: 'non-text response body',
      contentType: contentType || null,
    };
  } catch (error) {
    return {
      unreadable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function withLogging<TArgs extends [NextRequest, ...unknown[]]>(
  handler: RouteHandler<TArgs>
) {
  return async (...args: TArgs) => {
    const [request] = args;
    const url = new URL(request.url);
    const body = await readBodyForLog(request);

    console.log(`[API request] ${request.method} ${url.pathname}`, body);

    const response = await handler(...args);
    const responseBody = await readResponseForLog(response);

    console.log(
      `[API response] ${request.method} ${url.pathname} ${response.status}`,
      responseBody
    );

    return response;
  };
}
