import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import { checkPage } from '../../src/core/check.js';
import { fieldConcept, place, resolveField, template } from '../../src/core/components.js';
import { addBigQuerySource, type SourceField } from '../../src/core/datasource.js';
import { renderPage } from '../../src/core/render.js';
import { listReports } from '../../src/looker/reports.js';
import { createLabReport, labPrefix, openLane, sweep, type Lane } from './lab.js';

// Lane check: each lane makes a lab report, connects a BigQuery table,
// writes a text box, a working scorecard and a broken one, renders the page,
// checks the charts, and is refused a write to a report it did not create.
// Lanes run side by side; LANES=1 runs one.

const LANES = Number(process.env.LANES ?? 3);
// A BigQuery table the account can read, as project.dataset.table, with a
// date and a numeric "sessions" column.
const [projectId, datasetId, tableId] = (process.env.LOOKER_STUDIO_MCP_LAB_TABLE ?? '').split('.');
if (!projectId || !datasetId || !tableId) throw new Error('Set LOOKER_STUDIO_MCP_LAB_TABLE=project.dataset.table for the live tests.');
const TABLE = { projectId, datasetId, tableId };

type Json = Record<string, any>;

function textBox(html: string): Json {
  const c = place(template('simple-description'), { left: 20, top: 20, width: 700, height: 50 });
  c.propertyConfig.componentProperty.descriptionProperty.text = html;
  return c;
}

function scorecard(datasourceId: string, field: SourceField, left: number): Json {
  const c = place(template('kpi-metric'), { left, top: 90, width: 260, height: 110 });
  const concept = fieldConcept(field, { aggregation: 6 });
  c.datasourceId = datasourceId;
  c.conceptDefs = [concept];
  const p = c.propertyConfig.componentProperty;
  p.metrics.labeledConcepts = p.metrics.labeledConcepts.map((lc: Json) => ({ ...lc, value: { conceptNames: lc.key === 'primary' ? [concept.name] : [] } }));
  p.dataset = { datasetType: 1, datasetId: datasourceId };
  return c;
}

// A report the lane did not create: the lab must never be able to write to it.
const pick = '00000000-0000-0000-0000-000000000000';

const lanes: Lane[] = [];

// Runs even when a lane fails, so a failed run leaves nothing behind either.
afterAll(async () => {
  for (const lane of lanes) {
    console.log(`lane ${lane.n}: deleted ${(await sweep(lane)).length} lab report(s)`);
    expect(await listReports(lane.rap, { query: labPrefix(lane.n), owned: true })).toEqual([]);
  }
});

describe('lab lanes', () => {
  it(`${LANES} lane(s) build, render and check a page side by side`, async () => {
    const opened = await Promise.all(Array.from({ length: LANES }, (_, i) => openLane(i + 1)));
    lanes.push(...opened);
    const results = await Promise.allSettled(opened.map(runLane));
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`lane ${i + 1}: ${String(r.reason?.stack ?? r.reason)}`] : []));
    expect(failed).toEqual([]);
  });
});

async function runLane(lane: Lane): Promise<void> {
  const t0 = Date.now();
  const lap = (what: string) => console.log(`lane ${lane.n} ${what} +${Math.round((Date.now() - t0) / 100) / 10}s`);
  const marker = `looker-studio-mcp lab ${lane.n} check`;

  const { reportId, pageId } = await createLabReport(lane, 'P0 레인 검증 (자동 삭제)');
  lap(`report ${reportId}`);
  const source = await addBigQuerySource(lane, reportId, TABLE);
  expect(source.fields.map((f) => f.id)).toContain('_sessions_');
  lap(`data source ${source.alias}`);

  const good = scorecard(source.datasourceId, resolveField(source.fields, 'sessions'), 20);
  const bad = scorecard(source.datasourceId, { id: '_no_such_field_', name: 'broken', dataType: 3, aggregation: 6 }, 300);
  const write = await lane.session.editPage(reportId, pageId, (page) => {
    page.page.componentConfig = [textBox(`<div><b>${marker}</b></div>`), good, bad];
  }, 'lane check');
  expect(write.version).toMatch(/^\d+$/);
  expect(write.snapshot).toBeDefined();
  lap(`page v${write.version}, snapshot ${write.snapshot}`);

  const doc = await lane.session.load(reportId);
  const shot = await renderPage(lane.rap, doc, pageId, { dir: lane.dir, name: 'lane-check' });
  expect(shot.png && existsSync(shot.png)).toBeTruthy();
  expect(execFileSync('pdftotext', [shot.pdf, '-'], { encoding: 'utf8' })).toContain(marker);
  lap(`render ${shot.png} (${shot.converter})`);

  const checks = await checkPage(lane.rap, doc, pageId);
  expect(checks.find((c) => c.componentId === good.componentId)).toMatchObject({ ok: true });
  expect(checks.find((c) => c.componentId === good.componentId)?.rows).toBeGreaterThan(0);
  expect(checks.find((c) => c.componentId === bad.componentId)).toMatchObject({ ok: false, error: expect.stringContaining('broken (_no_such_field_)') });
  lap(`check ${JSON.stringify(checks.map((c) => [c.ok, c.rows ?? c.error]))}`);

  // Refused before anything is sent.
  await expect(lane.rap.call('updatePage', { reportId: pick, pageId: 'x', pageRequest: {}, version: '1' })).rejects.toMatchObject({ code: 'refused' });
  await expect(lane.rap.call('updateReportSharing', { reportId })).rejects.toMatchObject({ code: 'refused' });
  lap('guard refused the other report and sharing');
}
