import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile, appendFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = new Set(['connector_list', 'component_template_inspect', 'component_template_add',
  'report_create', 'report_delete', 'report_check', 'report_render', 'report_spec_export', 'report_spec_apply',
  'datasource_add', 'datasource_list', 'datasource_refresh', 'datasource_remove', 'field_update',
  'calculated_field_add', 'chart_add', 'page_add', 'page_list', 'component_list', 'component_inspect']);
const SETUP = new Set(['datasource_add', 'datasource_list', 'datasource_refresh', 'datasource_remove',
  'field_update', 'calculated_field_add', 'chart_add', 'component_list', 'component_inspect']);
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const error = (message) => { throw new Error(message); };
const bodyText = (result) => (result.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
const execFileAsync = promisify(execFile);

export function redact(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => /token|authorization|cookie|xsrf|password|credential|private.?key/i.test(key)
    ? '[redacted]'
    : typeof item === 'string' ? item.replace(/ya29\.[A-Za-z0-9._~-]+/g, '[redacted]').replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
      .replace(/((?:access_token|refresh_token|id_token|password)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[redacted]') : item));
}

export function expandEnvironment(value, env = process.env) {
  if (Array.isArray(value)) return value.map((item) => expandEnvironment(item, env));
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && typeof value.$env === 'string') {
    if (/token|password|credential|secret|private.?key/i.test(value.$env)) error('Secrets cannot be substituted into scenarios.');
    if (!env[value.$env]) error(`Missing scenario environment variable: ${value.$env}`);
    return env[value.$env];
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandEnvironment(item, env)]));
}

function spreadsheetId(value) {
  if (typeof value !== 'string') error('A spreadsheet must be an ID or a Google Sheets URL.');
  if (/^[\w-]+$/.test(value)) return value;
  const url = new URL(value);
  const match = /^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match) error('Use an approved Google Sheets ID or URL.');
  return match[1];
}

export function validateSource(source, scenario) {
  if (!source || typeof source !== 'object') error('A connection source is required.');
  if (source.reusable) error('Reusable account sources are outside this test.');
  if (source.dataset_id !== undefined || source.table_id !== undefined) error('Only synthetic SELECT queries and approved spreadsheets are allowed.');
  if (source.project_id !== undefined && source.project_id !== scenario.billing_project) error('The billing project is not approved by this scenario.');
  const connector = source.connector ?? 'bigquery';
  if (connector === 'google_sheets') {
    if (!(scenario.allowed_spreadsheets ?? []).includes(spreadsheetId(source.spreadsheet))) error('The spreadsheet is not approved by this scenario.');
    if (source.sql !== undefined) error('A spreadsheet source cannot include SQL.');
  } else if (connector === 'bigquery') {
    if (typeof scenario.billing_project !== 'string' || !scenario.billing_project.trim()) error('BigQuery scenarios need an explicit approved billing_project.');
    if (typeof source.sql !== 'string' || !/^\s*SELECT\b/i.test(source.sql)) error('BigQuery fixtures must use SELECT constants.');
    // Deliberately restrictive: even keywords inside strings are refused.
    if (/\b(FROM|JOIN|CREATE|INSERT|UPDATE|DELETE|MERGE|EXPORT|EXECUTE|CALL)\b|;|--|\/\*/i.test(source.sql)) error('Only a single synthetic SELECT without table reads is allowed.');
  } else error('This runner supports BigQuery and Google Sheets only.');
  rejectConsent(source);
}

function rejectConsent(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/viewer.?email|sharing|grant_editor_access|make_reusable|credentials/i.test(key)
      || (typeof item === 'string' && /DS_USER_EMAIL/i.test(item))) error('Consent, sharing and credential changes are outside this test.');
    rejectConsent(item);
  }
}

export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object' || !/^[a-z0-9][a-z0-9-]{0,60}$/i.test(scenario.name ?? '')) error('Scenario name must be a short slug.');
  if (!Array.isArray(scenario.templates) || !scenario.templates.length) error('At least one template is required.');
  if (!Number.isInteger(scenario.expect?.normal) || !Number.isInteger(scenario.expect?.total)
    || scenario.expect.normal < 0 || scenario.expect.total < 1 || scenario.expect.normal > scenario.expect.total) error('Expected normal and total chart counts are required.');
  if (scenario.expect.normal !== scenario.expect.total && !(scenario.expect.includes?.length)) error('An expected abnormal result must include its diagnostic text.');
  if (scenario.roundtrip !== undefined && typeof scenario.roundtrip !== 'boolean') error('roundtrip must be a boolean.');
  if (!(scenario.allowed_spreadsheets ?? []).every((id) => typeof id === 'string' && /^[\w-]+$/.test(id))) error('Allowed spreadsheets must be file IDs.');
  validateSource(scenario.source, scenario);
  for (const step of scenario.setup ?? []) {
    if (!SETUP.has(step.tool) || !step.args || typeof step.args !== 'object') error('Unsupported setup step.');
    if (step.args.report_id !== undefined || step.args.path !== undefined) error('Setup steps cannot supply a report ID or path.');
    if (step.tool === 'datasource_add') validateSource(step.args, scenario);
    rejectConsent(step.args);
  }
  for (const template of scenario.templates) {
    if (typeof template.template_id !== 'string' || !template.bindings || typeof template.bindings !== 'object') error('Templates need template_id and bindings.');
    if (template.report_id !== undefined) error('Template report IDs are assigned by the runner.');
  }
  for (const key of ['includes', 'metadata_includes', 'render_text_includes']) {
    const needles = scenario.expect[key] ?? [];
    if (!Array.isArray(needles) || needles.some((needle) => typeof needle !== 'string' || !needle.trim())) error('Assertions must be arrays of nonempty text.');
  }
  return scenario;
}

export function assertCheck(text, expected) {
  const match = /\b(\d+) normal \/ (\d+) total\b/.exec(text);
  if (!match || Number(match[1]) !== expected.normal || Number(match[2]) !== expected.total) error('report_check did not match the expected chart counts.');
  assertIncludes(text, expected.includes ?? []);
}

function assertIncludes(text, needles) {
  for (const needle of needles) if (!text.includes(needle)) error(`Required result text is missing: ${needle}`);
}

const normalizedText = (text) => text.replace(/\s+/gu, ' ').trim();

export function assertRenderText(text, needles) {
  const normalized = normalizedText(text);
  for (const needle of needles) if (!normalized.includes(normalizedText(needle))) error(`Required rendered text is missing: ${needle}`);
  return normalized;
}

async function pdfText(path) {
  const { stdout } = await execFileAsync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

// Only read the PDF returned by this MCP server inside this run's render
// directory. Neither a scenario path nor a symlink can select another file.
export async function readRenderedText(responseText, dir, extractPdfText = pdfText) {
  const paths = responseText.split('\n').flatMap((line) => line.startsWith('PDF: ') ? [line.slice(5).trim()] : []);
  if (paths.length !== 1 || !isAbsolute(paths[0]) || !/\.pdf$/i.test(paths[0])) error('report_render must return exactly one local PDF artifact for text assertions.');
  const output = await realpath(dir);
  const expectedRoot = join(output, 'server-home', 'renders');
  const renderRoot = await realpath(expectedRoot);
  if (renderRoot !== expectedRoot) error('The render directory must not redirect through a symlink.');
  const file = await realpath(paths[0]);
  const pathWithin = relative(renderRoot, file);
  if (!pathWithin || pathWithin.startsWith('..') || isAbsolute(pathWithin)) error('The PDF artifact is outside this run’s render directory.');
  return normalizedText(await extractPdfText(file));
}

export function fieldMetadata(text) {
  let source = '';
  const fields = [];
  for (const line of text.split('\n')) {
    const heading = /^(ds\d+ "[^"]*") \(id /.exec(line);
    if (heading) source = heading[1];
    if (/^\s+- .+\(.+\): /.test(line)) fields.push(`${source} ${line.trim().replace(/ \([^)]*\): /, ': ')}`);
  }
  return fields.sort();
}

export function exportedSpec(text) {
  const match = /```json\s*([\s\S]*?)```/.exec(text);
  if (!match) error('report_spec_export returned no JSON specification.');
  return JSON.parse(match[1]);
}

export function compareRoundtrip(original, restored) {
  const a = structuredClone(original.spec), b = structuredClone(restored.spec);
  delete a.name; delete b.name;
  const specEqual = isDeepStrictEqual(a, b);
  delete a.theme; delete b.theme;
  const themeOnly = !specEqual && isDeepStrictEqual(a, b);
  const fieldsEqual = isDeepStrictEqual(fieldMetadata(original.metadata), fieldMetadata(restored.metadata));
  const imagesEqual = original.images.length > 0 && original.images.length === restored.images.length
    && original.images.every((image, index) => image.sha256 === restored.images[index].sha256);
  return {
    status: !fieldsEqual || !imagesEqual || (!specEqual && !themeOnly) ? 'fail' : themeOnly ? 'review_required' : 'pass',
    field_metadata_equal_except_ids: fieldsEqual, image_bytes_equal: imagesEqual,
    spec_equal_except_name: specEqual, theme_representation_difference: themeOnly,
    note: themeOnly ? 'Theme representation differs. A supervisor must compare the preset defaults; equal images alone do not prove the themes are equivalent.' : undefined,
  };
}

export async function runScenario(scenario, { client, dir, lane = 1, progress = () => {}, extractPdfText = pdfText }) {
  validateScenario(scenario);
  if (![1, 2, 3].includes(lane)) error('Lane must be 1, 2 or 3.');
  await mkdir(dir, { recursive: true });
  for (const file of ['result.json', 'calls.ndjson', 'created.json']) {
    if (await access(join(dir, file)).then(() => true, () => false)) error('Use a fresh output directory so earlier report ownership and evidence are not overwritten.');
  }
  const prefix = `[looker-studio-mcp-lab-${lane}] connector-e2e ${scenario.name} `;
  const reports = new Map();
  const renderAssertions = scenario.expect.render_text_includes ?? [];
  const result = { status: 'running', scenario: scenario.name, lane, started_at: new Date().toISOString(), steps: [],
    verification_scope: 'MCP chart diagnostics, expected metadata/render text, field metadata and exact render/spec roundtrip. Configured text assertions do not replace reviewing the saved visual design.',
    numeric_values: renderAssertions.length ? 'pending_render_text_assertions' : 'manual_review_required',
    cleanup: { reports: [], errors: [], permanent_cleanup_required: true } };
  const save = async () => writeFile(join(dir, 'result.json'), JSON.stringify(redact(result), null, 2));
  const saveReports = async () => writeFile(join(dir, 'created.json'), JSON.stringify([...reports].map(([id, report]) => ({ id, ...report })), null, 2));
  let sequence = 0;
  async function call(name, args, expectError = false) {
    if (!TOOLS.has(name)) error('Tool is outside the connector E2E scope.');
    if (args.report_id && !reports.has(args.report_id)) error('This report was not created by the runner.');
    if (['report_create', 'report_spec_apply'].includes(name) && !args.name?.startsWith(prefix)) error('Creation requires this run’s experiment prefix.');
    if (name === 'report_create' || name === 'datasource_add') validateSource(args, scenario);
    if (name === 'report_spec_apply') {
      if (args.spec_path || !args.spec) error('Only the specification returned by MCP may be applied.');
      for (const source of args.spec.data_sources ?? []) validateSource(source, scenario);
      rejectConsent(args.spec);
    }
    const number = ++sequence;
    // Log the intent first so a transport failure still has an audit trail.
    await appendFile(join(dir, 'calls.ndjson'), JSON.stringify(redact({ number, phase: 'request', name, args })) + '\n');
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 });
    const text = bodyText(response);
    let createdId;
    if (name === 'report_create' || name === 'report_spec_apply') {
      const pattern = new RegExp(`(?:\\|\\s*|Created |The report was created: |The report exists: |The copy exists: )(${UUID})(?=\\s*\\||:|\\s|$)`, 'i');
      createdId = pattern.exec(text)?.[1];
      if (createdId && !reports.has(createdId)) { reports.set(createdId, { name: args.name, status: 'active' }); await saveReports(); }
    }
    if (name === 'report_delete' && !response.isError) { reports.get(args.report_id).status = 'trashed'; await saveReports(); }
    const images = [], content = [];
    for (const [index, item] of (response.content ?? []).entries()) {
      if (item.type === 'image') {
        const bytes = Buffer.from(item.data, 'base64');
        const file = `${number}-${name}-${index}.${item.mimeType === 'image/png' ? 'png' : 'image'}`;
        await writeFile(join(dir, file), bytes);
        const artifact = { type: 'mcp_image_artifact', file, mime_type: item.mimeType, sha256: createHash('sha256').update(bytes).digest('hex') };
        images.push(artifact); content.push(artifact);
      } else content.push(item);
    }
    await appendFile(join(dir, 'calls.ndjson'), JSON.stringify(redact({ number, phase: 'response', name, result: { ...response, content } })) + '\n');
    result.steps.push({ number, tool: name, is_error: !!response.isError, expected_error: expectError }); await save();
    progress({ number, tool: name, is_error: !!response.isError });
    if (!!response.isError !== expectError) error(`${name}: ${text}`);
    if (!response.isError && ['report_create', 'report_spec_apply'].includes(name) && !createdId) error('Creation succeeded without an identifiable report ID; inspect the saved MCP response before retrying.');
    return { text, images, createdId };
  }
  async function inspect(reportId, label) {
    const metadata = (await call('datasource_list', { report_id: reportId, fields: true })).text;
    assertIncludes(metadata, scenario.expect.metadata_includes ?? []);
    const check = (await call('report_check', { report_id: reportId })).text;
    assertCheck(check, scenario.expect);
    const pages = scenario.render_pages ?? [1], images = [], renderedText = [];
    for (const [index, page] of pages.entries()) {
      const rendered = await call('report_render', { report_id: reportId, page });
      images.push(...rendered.images);
      if (renderAssertions.length) {
        const content = await readRenderedText(rendered.text, dir, extractPdfText);
        renderedText.push(content);
        await writeFile(join(dir, `${label}-page-${index + 1}-render.txt`), redact(content));
      }
    }
    if (!images.length) error('No MCP image was returned; a PDF path is not a verified render.');
    if (renderAssertions.length) assertRenderText(renderedText.join('\n'), renderAssertions);
    const spec = exportedSpec((await call('report_spec_export', { report_id: reportId, style: 'all' })).text);
    await writeFile(join(dir, `${label}-spec.json`), JSON.stringify(redact(spec), null, 2));
    await writeFile(join(dir, `${label}-metadata.txt`), redact(metadata));
    return { metadata, check, images, spec, ...(renderAssertions.length ? { render_text_assertions_passed: true } : {}) };
  }
  try {
    const catalog = await client.listTools();
    await writeFile(join(dir, 'tools.json'), JSON.stringify(redact(catalog), null, 2));
    result.tools = catalog.tools.map((tool) => tool.name);
    await call('connector_list', {});
    for (const template of scenario.templates) await call('component_template_inspect', { template_id: template.template_id });
    const originalId = (await call('report_create', { ...scenario.source, name: prefix + 'original' })).createdId;
    result.original_report = originalId;
    await call('datasource_list', { report_id: originalId, fields: true });
    for (const step of scenario.setup ?? []) {
      const response = await call(step.tool, { ...step.args, report_id: originalId }, step.expect_error ?? false);
      assertIncludes(response.text, step.expect_text ?? []);
    }
    for (const template of scenario.templates) await call('component_template_add', { ...template, report_id: originalId });
    result.original = await inspect(originalId, 'original');
    if (scenario.roundtrip !== false) {
      const restoredId = (await call('report_spec_apply', { name: prefix + 'restored', spec: result.original.spec })).createdId;
      result.restored_report = restoredId;
      result.restored = await inspect(restoredId, 'restored');
      result.comparison = compareRoundtrip(result.original, result.restored);
      result.status = result.comparison.status;
    } else result.status = 'pass';
    if (renderAssertions.length) result.numeric_values = 'configured_render_text_assertions_passed';
  } catch (caught) {
    result.status = 'fail'; result.error = String(caught);
    if (renderAssertions.length) result.numeric_values = 'render_text_assertions_failed_or_incomplete';
  }
  finally {
    for (const [id, report] of reports) if (report.status === 'active') {
      try { await call('report_delete', { report_id: id, confirm_name: report.name }); }
      catch (caught) { result.cleanup.errors.push(String(caught)); }
    }
    result.cleanup.reports = [...reports].map(([id, report]) => ({ id, ...report }));
    if (result.cleanup.errors.length) result.status = 'fail';
    result.completed_at = new Date().toISOString();
    result.completed_tool_calls = result.steps.length;
    await save();
  }
  return result;
}

async function cli() {
  const args = process.argv.slice(2);
  const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  if (args.includes('--help')) {
    console.log('node scripts/connector-e2e.mjs --scenario <JSON> --output <external directory> [--lane 1|2|3]'); return;
  }
  const file = value('--scenario'), output = value('--output');
  if (!file || !output) error('Supply --scenario and --output; use --help for usage.');
  const lane = Number(value('--lane') ?? 1);
  if (![1, 2, 3].includes(lane)) error('Lane must be 1, 2 or 3.');
  const scenario = validateScenario(expandEnvironment(JSON.parse(await readFile(resolve(file), 'utf8'))));
  const dir = resolve(output);
  await mkdir(dir, { recursive: true });
  const actual = await realpath(dir), fromRepo = relative(REPO, actual);
  if (!fromRepo || (!fromRepo.startsWith('..') && !isAbsolute(fromRepo))) error('Keep test artifacts and local fixture identifiers outside the repository.');
  const home = join(dir, 'server-home'); await mkdir(home, { recursive: true });
  await writeFile(join(home, 'config.json'), JSON.stringify({ writes_enabled: true, dry_run: false,
    ...(scenario.billing_project ? { billing_project: scenario.billing_project } : {}),
    ...(process.env.LOOKER_STUDIO_MCP_COMPONENT_LIBRARY ? { component_library: process.env.LOOKER_STUDIO_MCP_COMPONENT_LIBRARY } : {}) }));
  const client = new Client({ name: 'connector-e2e', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(REPO, 'build/cli.js'), 'serve'], cwd: REPO,
    env: { ...process.env, LOOKER_STUDIO_MCP_HOME: home, LOOKER_STUDIO_MCP_SESSION: `looker-studio-mcp-connector-e2e-${lane}` }, stderr: 'pipe' });
  // Do not save arbitrary stderr: an external dependency could print a secret
  // split across chunks. Structured MCP results are redacted before storage.
  transport.stderr?.resume();
  try {
    await client.connect(transport);
    const result = await runScenario(scenario, { client, dir, lane, progress: (step) => console.log(`${step.number} ${step.tool}: ${step.is_error ? 'error' : 'ok'}`) });
    console.log(`Result: ${result.status}. Reports moved to trash; inspect the manifest for supervisor permanent cleanup.`);
    process.exitCode = result.status === 'pass' ? 0 : result.status === 'review_required' ? 2 : 1;
  } finally { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(() => {
  console.error('Connector E2E could not complete. Check its local result.json, scenario configuration and build.'); process.exitCode = 1;
});
