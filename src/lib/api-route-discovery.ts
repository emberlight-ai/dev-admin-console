import { promises as fs } from 'fs';
import path from 'path';

export type DiscoveredApiRoute = {
  /**
   * OpenAPI-ish path style (curly braces).
   * Example: /api/avatar/{userid}
   */
  apiPath: string;
  /**
   * Absolute file path to the route handler.
   */
  filePath: string;
  methods: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function toApiPathFromRouteFile(appApiDir: string, filePath: string) {
  const rel = path.relative(appApiDir, filePath).split(path.sep);
  // [...]/api/<segments>/route.ts -> /api/<segments>
  const withoutRoute = rel.slice(0, -1);
  const mapped = withoutRoute.map((seg) => {
    // Dynamic segment: [userid] -> {userid}
    if (seg.startsWith('[') && seg.endsWith(']')) {
      return `{${seg.slice(1, -1)}}`;
    }
    return seg;
  });
  return `/api/${mapped.join('/')}`;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (ent.isFile() && ent.name === 'route.ts') {
      out.push(p);
    }
  }
  return out;
}

function parseMethodsFromSource(src: string): DiscoveredApiRoute['methods'] {
  const methods: DiscoveredApiRoute['methods'] = [];
  for (const m of HTTP_METHODS) {
    // Covers: export async function GET(... or export function GET(...
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\s*\\(`);
    if (re.test(src)) methods.push(m);
  }
  return methods;
}

export async function discoverApiRoutes(): Promise<DiscoveredApiRoute[]> {
  // CWD is project root in Next runtime; this keeps it stable across environments.
  const appApiDir = path.join(process.cwd(), 'src', 'app', 'api');
  let files: string[] = [];
  try {
    files = await walk(appApiDir);
  } catch {
    // In some production deployments, source files may not be present on disk.
    // Discovery is best-effort; callers should still work using the curated catalog.
    return [];
  }

  const discovered: DiscoveredApiRoute[] = [];
  for (const filePath of files) {
    const src = await fs.readFile(filePath, 'utf8');
    const methods = parseMethodsFromSource(src);
    discovered.push({
      apiPath: toApiPathFromRouteFile(appApiDir, filePath),
      filePath,
      methods,
    });
  }

  discovered.sort((a, b) => a.apiPath.localeCompare(b.apiPath));
  return discovered;
}


