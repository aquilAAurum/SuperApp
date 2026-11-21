import { describe, expect, it } from 'vitest';
import { MemoryGrantStore, checkScope, grantedScopes } from './permissions.ts';
import { manifest } from '../test-helpers.ts';

describe('scope checks', () => {
  it('denies anything the manifest does not declare (even if granted)', () => {
    const g = new MemoryGrantStore();
    g.set('hello', 'device.location', 'allow');
    expect(checkScope(manifest(), 'device.location', g)).toEqual({ ok: false, reason: 'not_declared' });
  });
  it('needs consent for consent-gated scopes', () => {
    const g = new MemoryGrantStore();
    expect(checkScope(manifest(), 'device.contacts.read', g)).toEqual({ ok: false, reason: 'consent_required' });
    g.set('hello', 'device.contacts.read', 'deny');
    expect(checkScope(manifest(), 'device.contacts.read', g)).toEqual({ ok: false, reason: 'denied' });
    g.set('hello', 'device.contacts.read', 'allow');
    expect(checkScope(manifest(), 'device.contacts.read', g)).toEqual({ ok: true });
  });
  it('lists granted scopes for the welcome', () => {
    expect(grantedScopes(manifest(), new MemoryGrantStore())).toEqual(['bus.emit:hello.note.created', 'data.own']);
  });
});
