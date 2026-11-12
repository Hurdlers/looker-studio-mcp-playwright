import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BigQueryConfig {
  // Project queries are billed to and listed from when a tool is given none;
  // the ADC project when unset.
  billingProject?: string;
  // Where jobs run. Unset lets BigQuery pick the location of the tables read.
  location?: string;
  // Most rows a query returns.
  maxRows: number;
  // A query that would bill more bytes fails instead of running.
  maxBytesBilled: number;
}

export interface Config {
  home: string;
  // Write tools are registered only when this is true.
  writesEnabled: boolean;
  // Write tools say what they would change and save nothing.
  dryRun: boolean;
  bigquery: BigQueryConfig;
  // Operator-managed component definitions; never a client-supplied file path.
  componentLibrary?: string;
  browser: BrowserConfig;
}

export interface BrowserConfig {
  // Chrome or Chromium executable. Found automatically when unset.
  chromePath?: string;
  // Run the dedicated browser without a window. Sign in with a window first.
  headless: boolean;
}

// <home>/config.json, all keys optional:
//   { "writes_enabled": false, "dry_run": false,
//     "billing_project": "my-project", "location": "asia-northeast3",
//     "max_rows": 500, "max_bytes_billed": 1000000000,
//     "chrome_path": "/path/to/chrome", "headless": false }
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.LOOKER_STUDIO_MCP_HOME ?? join(homedir(), '.looker-studio-mcp');
  const file = join(home, 'config.json');
  const raw = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  return parseConfig(raw, home);
}

export function parseConfig(raw: Record<string, unknown>, home: string): Config {
  const text = (key: string): string | undefined => (typeof raw[key] === 'string' && raw[key] ? (raw[key] as string) : undefined);
  const count = (key: string, fallback: number): number => {
    const n = raw[key];
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const billingProject = text('billing_project');
  const location = text('location');
  return {
    home,
    writesEnabled: raw.writes_enabled === true,
    dryRun: raw.dry_run === true,
    ...(text('component_library') ? { componentLibrary: text('component_library')! } : {}),
    browser: { ...(text('chrome_path') ? { chromePath: text('chrome_path')! } : {}), headless: raw.headless === true },
    bigquery: {
      ...(billingProject ? { billingProject } : {}),
      ...(location ? { location } : {}),
      maxRows: count('max_rows', 500),
      maxBytesBilled: count('max_bytes_billed', 1_000_000_000),
    },
  };
}
