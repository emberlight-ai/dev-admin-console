import { NextResponse } from 'next/server';

import { apiCatalog } from '@/app/admin/api-documents/api-catalog';
import { iosApiCatalog } from '@/app/admin/api-documents/ios-catalog';
import { discoverApiRoutes } from '@/lib/api-route-discovery';

export const runtime = 'nodejs';

type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
};

function toLowerMethod(m: string) {
  return m.toLowerCase();
}

function collectPathParams(p: string) {
  return Array.from(p.matchAll(/\{([^}]+)\}/g)).map((m) => m[1]);
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const discovered = await discoverApiRoutes();

  const paths: OpenApiDoc['paths'] = {};

  // First: catalog (rich docs) - merge admin + ios
  for (const ep of [...apiCatalog, ...iosApiCatalog]) {
    const p = ep.path;
    if (!paths[p]) paths[p] = {};

    const parameters: unknown[] = [];
    for (const name of collectPathParams(p)) {
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }
    for (const prm of ep.params ?? []) {
      if (prm.in === 'query' || prm.in === 'header') {
        parameters.push({
          name: prm.name,
          in: prm.in,
          required: Boolean(prm.required),
          description: prm.description,
          schema: { type: 'string' },
          example: prm.example,
        });
      }
    }

    const methodObj: Record<string, unknown> = {
      summary: ep.summary,
      description: ep.description,
      parameters: parameters.length ? parameters : undefined,
      responses: {
        200: {
          description: 'OK',
          content:
            ep.id === 'avatar.get'
              ? {
                  'image/*': {
                    example: 'binary',
                  },
                }
              : {
                  'application/json': {
                    example: ep.responseExample ?? {},
                  },
                },
        },
        400: { description: 'Bad Request' },
        500: { description: 'Server Error' },
      },
    };

    if (ep.method !== 'GET' && ep.id !== 'avatar.get') {
      methodObj.requestBody = {
        required: true,
        content: {
          'application/json': {
            example: ep.requestExample ?? {},
          },
        },
      };
    }

    paths[p][toLowerMethod(ep.method)] = methodObj;
  }

  // Second: discovered (fallback)
  for (const d of discovered) {
    const p = d.apiPath;
    if (!paths[p]) paths[p] = {};

    for (const m of d.methods) {
      const key = toLowerMethod(m);
      if (paths[p][key]) continue;

      const parameters: unknown[] = [];
      for (const name of collectPathParams(p)) {
        parameters.push({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        });
      }

      paths[p][key] = {
        summary: 'Undocumented endpoint',
        description: `Discovered from source: ${d.filePath}`,
        parameters: parameters.length ? parameters : undefined,
        responses: {
          200: { description: 'OK' },
          400: { description: 'Bad Request' },
          500: { description: 'Server Error' },
        },
      };
    }
  }

  const doc: OpenApiDoc = {
    openapi: '3.0.3',
    info: {
      title: 'GetDevTeam API',
      version: '0.1.0',
      description:
        'Generated OpenAPI spec for app API routes. For interactive testing, use /admin/api-documents.',
    },
    servers: [{ url: origin }],
    paths,
  };

  return NextResponse.json(doc);
}


