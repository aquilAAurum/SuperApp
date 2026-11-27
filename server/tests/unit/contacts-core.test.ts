import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { project, same } = require('../../pb_hooks/lib/contacts-core.js') as {
  project: (person: Record<string, unknown>, points: Record<string, unknown>[]) => Record<string, unknown> & { phones: unknown[]; emails: unknown[]; deleted: boolean };
  same: (core: Record<string, unknown> | null, want: Record<string, unknown>) => boolean;
};

const person = { id: 'abcdefghij12345', display_name: 'Ava Torres', deleted: false };
const pt = (channel: string, value_norm: string, extra: Record<string, unknown> = {}) => ({ channel, value_norm, label: null, is_primary: false, is_valid: true, deleted: false, ...extra });

describe('contacts → core_people projection (SA-2026-007 §4.4.0)', () => {
  it('maps valid phones (incl. Google Voice / WhatsApp) and emails, primary first, deduplicated', () => {
    const want = project(person, [
      pt('email', 'ava@work.example'),
      pt('email', 'ava@home.example', { is_primary: true }),
      pt('phone', '+15550102030', { label: 'mobile' }),
      pt('phone', '+15550102030'),
      pt('google_voice', '+15550109999'),
      pt('whatsapp', '+447700900123'),
      pt('other', '(555) 010-7179', { label: 'fax' }),
      pt('email', 'bad@', { is_valid: false }),
      pt('email', 'old@example.com', { deleted: true }),
      pt('linkedin', 'linkedin.com/in/ava'),
    ]);
    expect(want).toEqual({
      displayName: 'Ava Torres',
      phones: [
        { e164: '+15550102030', type: 'phone', label: 'mobile', primary: false },
        { e164: '+15550109999', type: 'gvoice', label: null, primary: false },
        { e164: '+447700900123', type: 'whatsapp', label: null, primary: false },
      ],
      emails: [
        { address: 'ava@home.example', label: null, primary: true },
        { address: 'ava@work.example', label: null, primary: false },
      ],
      sourceIds: { contacts: 'abcdefghij12345' },
      deleted: false,
    });
  });

  it('same() detects when nothing needs saving', () => {
    const want = project(person, [pt('email', 'ava@home.example')]);
    expect(same(null, want)).toBe(false);
    expect(same({ ...want }, want)).toBe(true);
    expect(same({ ...want, displayName: 'Ava T.' }, want)).toBe(false);
    expect(same({ ...want, emails: [] }, want)).toBe(false);
    expect(project({ ...person, deleted: true }, []).deleted).toBe(true);
  });
});
