import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import type { ToolContext } from '../../core/tool.js';

// Names checked before anything is sent, and the project a call goes to.

const PROJECT = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const DATASET = /^[A-Za-z0-9_]{1,1024}$/;
// Identifier for names this server writes into DDL (view ids).
const IDENTIFIER = /^[A-Za-z0-9_]{1,1024}$/;
// BigQuery's table naming rule: letters, marks, numbers, connectors (_),
// dashes and spaces, at most 1024 bytes.
const TABLE = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\p{Zs}]+$/u;

export const projectArg = z
  .string()
  .optional()
  .describe('Google Cloud project id, e.g. "my-project". Defaults to billing_project in the config, then the project of the Application Default Credentials.');
export const datasetArg = z.string().describe('Dataset id (letters, digits and underscores), e.g. "analytics_123456".');
export const tableArg = z.string().describe('Table or view name as BigQuery shows it; spaces and dashes are fine, e.g. "4 Demo".');

// The project given, else the configured billing project, else the ADC one.
export async function resolveProject(ctx: ToolContext, given: string | undefined): Promise<string> {
  const project = given || ctx.config.bigquery.billingProject || (await ctx.google.projectId());
  if (!project)
    throw new LookerError(
      'invalid',
      'No project: give project_id, or set billing_project in the config (or a project for the Application Default Credentials).',
    );
  if (!PROJECT.test(project))
    throw new LookerError('invalid', `"${project}" is not a project id: use lowercase letters, digits and dashes (6–63 characters, starting with a letter).`);
  return project;
}

export function checkDataset(id: string): string {
  if (!DATASET.test(id)) throw new LookerError('invalid', `"${id}" is not a dataset id: use only letters, digits and underscores.`);
  return id;
}

export function checkTable(id: string): string {
  if (!TABLE.test(id) || Buffer.byteLength(id) > 1024)
    throw new LookerError('invalid', `"${id}" is not a BigQuery table name: use letters, digits, underscores, dashes and spaces (at most 1024 bytes).`);
  return id;
}

export function checkIdentifier(id: string, what: string): string {
  if (!IDENTIFIER.test(id)) throw new LookerError('invalid', `"${id}" is not a valid ${what}: use only letters, digits and underscores.`);
  return id;
}
