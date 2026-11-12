import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// One line per write: what was changed, before and after which version, and
// the revision to restore to undo it. Secrets never reach the file.

export interface AuditEntry {
  tool: string;
  reportId?: string;
  result: 'ok' | 'error';
  version?: string;
  snapshot?: string;
  detail?: string;
}

export interface Audit {
  write(entry: AuditEntry): Promise<void>;
}

const SECRET = /token|password|secret|credential/i;

export class FileAudit implements Audit {
  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async write(entry: AuditEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const line = JSON.stringify({ at: this.now().toISOString(), ...entry }, (k, v) => (SECRET.test(k) ? '[redacted]' : v));
    await appendFile(this.path, `${line}\n`);
  }
}
