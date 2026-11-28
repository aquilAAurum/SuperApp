/**
 * All server calls live in src/server/ (spec implementation note 2; enforced by ESLint). The
 * PocketBase SDK uses an in-memory auth store; the token is persisted only via the broker's
 * Keystore-backed secret storage.
 */
import PocketBase, { BaseAuthStore, ClientResponseError } from 'pocketbase';
import type { Capabilities, FormFactor } from '@superapp/contracts';
import type { Logger } from '../core/logger.ts';
import type { OutboxRow, SyncRecord } from '../sync/store.ts';
import type { SendResult } from '../sync/worker.ts';
import { validateServerUrl } from '../core/url-policy.ts';
import type { SubappRecord } from '../host/updates.ts';

export const SECRET_TOKEN = 'superapp.server.token';
export const SECRET_DEVICE = 'superapp.device.id';

export interface SecretStore {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  removeSecret(key: string): Promise<void>;
}

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
}

export type Reachability = { state: 'online'; ms: number } | { state: 'offline' } | { state: 'error'; message: string };

export interface DeviceRegistration {
  name: string;
  kind: FormFactor;
  formFactor: FormFactor;
  shellVersion: string;
  capabilities: Capabilities['device'];
}

export class ServerClient {
  private pb: PocketBase | null = null;
  private baseUrl: string | null = null;

  constructor(
    private readonly secrets: SecretStore,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  get url(): string | null {
    return this.baseUrl;
  }

  configure(rawUrl: string): void {
    const res = validateServerUrl(rawUrl);
    if (!res.ok) throw new Error(res.error);
    this.baseUrl = res.url;
    this.pb = new PocketBase(res.url, new BaseAuthStore());
    this.pb.autoCancellation(false);
    this.pb.beforeSend = (url, options) => ({ url, options: { ...options, fetch: this.fetchImpl } });
  }

  private client(): PocketBase {
    if (!this.pb) throw new Error('Server URL is not configured.');
    return this.pb;
  }

  get user(): SignedInUser | null {
    const r = this.pb?.authStore.record;
    if (!r || !this.pb?.authStore.isValid) return null;
    return { id: r.id, name: String(r.name ?? ''), email: String(r.email ?? '') };
  }

  async health(timeoutMs = 4000): Promise<Reachability> {
    if (!this.baseUrl) return { state: 'offline' };
    const started = performance.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/health`, { signal: ctrl.signal });
      if (!res.ok) return { state: 'error', message: `HTTP ${res.status}` };
      return { state: 'online', ms: Math.round(performance.now() - started) };
    } catch {
      return { state: 'offline' };
    } finally {
      clearTimeout(t);
    }
  }

  async signIn(email: string, password: string): Promise<SignedInUser> {
    try {
      await this.client().collection('users').authWithPassword(email, password);
    } catch (err) {
      const status = err instanceof ClientResponseError ? err.status : 0;
      this.logger.warn('auth.sign_in_failed', { status });
      throw new Error(status === 400 ? 'Email or password is incorrect.' : status === 0 ? 'Server is unreachable.' : `Sign-in failed (HTTP ${status}).`, { cause: err });
    }
    await this.secrets.setSecret(SECRET_TOKEN, this.client().authStore.token);
    this.logger.info('auth.signed_in', { userId: this.user?.id });
    return this.user!;
  }

  /** Silent refresh with the stored token. Returns null if the user must sign in again. */
  async restore(): Promise<SignedInUser | null> {
    const token = await this.secrets.getSecret(SECRET_TOKEN);
    if (!token || !this.pb) return null;
    this.pb.authStore.save(token, null);
    try {
      await this.pb.collection('users').authRefresh();
      await this.secrets.setSecret(SECRET_TOKEN, this.pb.authStore.token);
      return this.user;
    } catch (err) {
      const status = err instanceof ClientResponseError ? err.status : 0;
      if (status === 401 || status === 403 || status === 404) {
        await this.signOut();
        return null;
      }
      // Offline: keep the token and continue in offline mode with the cached identity.
      this.logger.warn('auth.refresh_deferred', { status });
      return null;
    }
  }

  async signOut(): Promise<void> {
    this.pb?.authStore.clear();
    await this.secrets.removeSecret(SECRET_TOKEN);
  }

  /** Registers this shell install as a `core_devices` row (first run) and returns its id. */
  async registerDevice(reg: DeviceRegistration): Promise<string> {
    const existing = await this.secrets.getSecret(SECRET_DEVICE);
    const pb = this.client();
    const owner = this.user?.id;
    if (!owner) throw new Error('Sign in first.');
    const body = { ...reg, owner, lastSeen: new Date().toISOString() };
    if (existing) {
      try {
        await pb.collection('core_devices').update(existing, body);
        return existing;
      } catch (err) {
        if (!(err instanceof ClientResponseError) || err.status !== 404) throw err;
      }
    }
    const rec = await pb.collection('core_devices').create(body);
    await this.secrets.setSecret(SECRET_DEVICE, rec.id);
    this.logger.info('device.registered', { deviceId: rec.id, kind: reg.kind });
    return rec.id;
  }

  async heartbeat(deviceId: string): Promise<void> {
    try {
      await this.client().collection('core_devices').update(deviceId, { lastSeen: new Date().toISOString() });
    } catch (err) {
      this.logger.warn('device.heartbeat_failed', { status: err instanceof ClientResponseError ? err.status : 0 });
    }
  }

  async deviceId(): Promise<string | null> {
    return this.secrets.getSecret(SECRET_DEVICE);
  }

  /** Highest schema version this shell understands (spec: banner + paused writes above it). */
  static readonly SUPPORTED_SCHEMA = 1;

  async schemaVersion(): Promise<number | null> {
    try {
      const r = await this.client().collection('schema_info').getFirstListItem('', { sort: '-version' });
      return Number(r.version);
    } catch {
      return null;
    }
  }

  /** POST /api/sa/ops for one outbox row (spec §Sync write path step 4). */
  async sendOp(row: OutboxRow, deviceId: string | null, timeoutMs = 15_000): Promise<SendResult> {
    if (!this.pb || !this.baseUrl) return { kind: 'offline' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/sa/ops`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          authorization: this.pb.authStore.token,
          ...(deviceId ? { 'x-superapp-device': deviceId } : {}),
        },
        body: JSON.stringify({ opId: row.opId, collection: row.collection, recordId: row.recordId, op: row.op, payload: row.payload, ...(row.baseVersion !== null ? { baseVersion: row.baseVersion } : {}) }),
      });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        body = { message: text.slice(0, 200) };
      }
      return { kind: 'http', status: res.status, body };
    } catch (err) {
      return (err as Error).name === 'AbortError' ? { kind: 'timeout' } : { kind: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Catch-up query: records changed since `since` (spec §Read path). */
  async listSince(collection: string, since: string | null, filter?: string): Promise<SyncRecord[]> {
    // `>=` not `>`: records updated in the same millisecond as `since` must not be missed. The mirror
    // ignores versions it already has, so re-reading the boundary record is harmless.
    const parts = [since ? `updated >= "${since.replace(/"/g, '')}"` : '', filter ? `(${filter})` : ''].filter(Boolean);
    const items = await this.client().collection(collection).getFullList({ filter: parts.join(' && '), sort: 'updated', batch: 200 });
    return items as unknown as SyncRecord[];
  }

  async getRecord(collection: string, id: string): Promise<SyncRecord | null> {
    try {
      return (await this.client().collection(collection).getOne(id)) as unknown as SyncRecord;
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  }

  /** Published subapp bundles (ADR-009). The phone pulls; the server never pushes code. */
  async listSubapps(): Promise<SubappRecord[]> {
    const items = await this.client().collection('subapps').getFullList({ sort: 'appId,version', batch: 200, fields: 'id,collectionId,collectionName,appId,version,sha256,bundle' });
    return items.map((r) => ({ id: r.id, appId: String(r.appId), version: String(r.version), sha256: String(r.sha256), bundle: String(r.bundle) }));
  }

  /** Downloads a bundle zip. The `bundle` file field is protected, so the URL carries a short-lived file token. */
  async downloadSubapp(rec: SubappRecord, timeoutMs = 60_000): Promise<Uint8Array> {
    const pb = this.client();
    const token = await pb.files.getToken();
    const url = pb.files.getURL({ id: rec.id, collectionName: 'subapps', collectionId: 'subapps' }, rec.bundle, { token });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${rec.appId}@${rec.version}`);
      return new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  /** PocketBase realtime while in the foreground. Returns an unsubscribe function. */
  async subscribe(collection: string, onRecord: (r: SyncRecord) => void): Promise<() => Promise<void>> {
    const unsub = await this.client().collection(collection).subscribe('*', (e) => onRecord(e.record as unknown as SyncRecord));
    return unsub;
  }
}
