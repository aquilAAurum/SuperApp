/**
 * The only module that imports Capacitor plugins (spec implementation note 2; enforced by ESLint
 * `no-restricted-imports`). Every native call goes through here so that:
 *   - subapps never touch the device directly,
 *   - the same shell runs on web (E2E, dev) and on other form factors with capabilities discovered,
 *     not assumed (spec principle "device-agnostic contracts").
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { Capabilities, FormFactor, HealthBucket, HealthReadMetric, HealthUnavailableReason, HealthWriteRecord, HealthWriteType } from '@superapp/contracts';
import type { SqlDatabase } from '../sync/sqlite-kv.ts';
import type { DevicePort, HealthPort } from '../bridge/device-handlers.ts';

/**
 * In-repo Kotlin plugin (apps/shell/android/app/src/main/java/dev/superapp/shell/HealthConnectPlugin.kt,
 * ADR-010). Permission names are Health Connect's without the `android.permission.health.` prefix;
 * the plugin refuses any name outside its fixed allow-list.
 */
interface HealthConnectNative {
  status(): Promise<{ sdkStatus: 'available' | 'unavailable' | 'update_required'; granted: string[] }>;
  requestHealthPermissions(o: { permissions: string[] }): Promise<{ granted: string[] }>;
  aggregate(o: { metrics: HealthReadMetric[]; start: string; end: string; bucket: 'day' | 'none' }): Promise<{ buckets: HealthBucket[] }>;
  insert(o: { records: HealthWriteRecord[] }): Promise<{ written: number }>;
  delete(o: { type: HealthWriteType; clientIds: string[] }): Promise<{ deleted: number }>;
  /** Health Connect's own settings (manage or revoke), or its Play Store page when it must be installed/updated. */
  openSettings(): Promise<void>;
}
const HealthConnect = registerPlugin<HealthConnectNative>('HealthConnect');

export interface DeviceSummary {
  name: string;
  model: string;
  osVersion: string;
  webViewVersion: string;
  platform: 'android' | 'web';
}

export interface NetworkSummary {
  connected: boolean;
  type: string;
}

export class CapabilityBroker {
  /** Web fallback for secrets keeps them in memory only; nothing sensitive goes to localStorage. */
  private memorySecrets = new Map<string, string>();

  get platform(): 'android' | 'web' {
    return Capacitor.getPlatform() === 'android' ? 'android' : 'web';
  }

  get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  formFactor(): FormFactor {
    // v1 ships the phone shell; a TV build reports 'tv' from its own broker (spec §Scope).
    return 'phone';
  }

  async device(): Promise<DeviceSummary> {
    const info = await Device.getInfo();
    return {
      name: info.name ?? info.model,
      model: info.model,
      osVersion: info.osVersion,
      webViewVersion: info.webViewVersion,
      platform: this.platform,
    };
  }

  async network(): Promise<NetworkSummary> {
    const s = await Network.getStatus();
    return { connected: s.connected, type: s.connectionType };
  }

  async onNetworkChange(fn: (s: NetworkSummary) => void): Promise<() => void> {
    const h = await Network.addListener('networkStatusChange', (s) => fn({ connected: s.connected, type: s.connectionType }));
    return () => void h.remove();
  }

  async onResume(fn: () => void): Promise<() => void> {
    if (!this.isNative) {
      const listener = () => document.visibilityState === 'visible' && fn();
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    }
    const h = await App.addListener('resume', fn);
    return () => void h.remove();
  }

  async onBackButton(fn: () => void): Promise<() => void> {
    if (!this.isNative) return () => undefined;
    const h = await App.addListener('backButton', fn);
    return () => void h.remove();
  }

  /** What exists on this hardware (not what any app is granted). `health` is refreshed by health.status(). */
  private healthAvailable = false;

  deviceCapabilities(): Capabilities['device'] {
    const native = this.isNative;
    return {
      health: native && this.healthAvailable,
      location: native,
      contacts: native,
      haptics: native,
      battery: true,
      network: true,
      camera: native,
      notifications: native,
    };
  }

  // Secrets: Android Keystore-backed on device (spec §Security).
  async getSecret(key: string): Promise<string | null> {
    if (!this.isNative) return this.memorySecrets.get(key) ?? null;
    const v = await SecureStorage.get(key);
    return typeof v === 'string' ? v : null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    if (!this.isNative) {
      this.memorySecrets.set(key, value);
      return;
    }
    await SecureStorage.set(key, value);
  }

  async removeSecret(key: string): Promise<void> {
    if (!this.isNative) {
      this.memorySecrets.delete(key);
      return;
    }
    await SecureStorage.remove(key);
  }

  // Non-sensitive preferences (server URL, theme, safe mode).
  async getPref(key: string): Promise<string | null> {
    return (await Preferences.get({ key })).value;
  }

  async setPref(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  }

  /**
   * Opens the encrypted on-device SQLite database for the sync mirror and outbox (ADR-004,
   * HB-DATA-02). The passphrase is random, generated once, and held by the plugin in Android
   * Keystore-backed storage; it never leaves the device. Returns null on web (IndexedDB is used).
   */
  async openDatabase(name = 'superapp'): Promise<SqlDatabase | null> {
    if (!this.isNative) return null;
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    if (!(await sqlite.isSecretStored()).result) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      await sqlite.setEncryptionSecret(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
    }
    const consistent = (await sqlite.checkConnectionsConsistency()).result;
    const exists = (await sqlite.isConnection(name, false)).result;
    const db = consistent && exists ? await sqlite.retrieveConnection(name, false) : await sqlite.createConnection(name, true, 'secret', 1, false);
    await db.open();
    return {
      execute: async (sql) => {
        await db.execute(sql, false);
      },
      query: async <T>(sql: string, values: unknown[] = []) => ((await db.query(sql, values)).values ?? []) as T[],
      executeSet: async (set) => {
        await db.executeSet(set.map((x) => ({ statement: x.statement, values: x.values })), true);
      },
    };
  }

  // Health Connect (ADR-010). On web (dev, E2E) it reports unsupported.
  readonly health: HealthPort = {
    status: async () => {
      if (!this.isNative) return { available: false, reason: 'unsupported' as HealthUnavailableReason, granted: [] };
      const s = await HealthConnect.status();
      this.healthAvailable = s.sdkStatus === 'available';
      if (s.sdkStatus === 'available') return { available: true, granted: s.granted };
      return { available: false, reason: (s.sdkStatus === 'update_required' ? 'update_required' : 'not_installed') as HealthUnavailableReason, granted: [] };
    },
    requestPermissions: async (permissions) => (await HealthConnect.requestHealthPermissions({ permissions })).granted,
    aggregate: async (metrics, start, end, bucket) => (await HealthConnect.aggregate({ metrics, start, end, bucket })).buckets,
    insert: async (records) => (await HealthConnect.insert({ records })).written,
    delete: async (type, clientIds) => (await HealthConnect.delete({ type, clientIds })).deleted,
  };

  async openHealthSettings(): Promise<void> {
    if (this.isNative) await HealthConnect.openSettings();
  }

  async haptics(style: 'light' | 'medium' | 'heavy'): Promise<void> {
    if (!this.isNative) return;
    await Haptics.impact({ style: style === 'heavy' ? ImpactStyle.Heavy : style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
  }

  /** The subset of the broker the device.* bridge handlers use. */
  devicePort(): DevicePort {
    return { health: this.health, haptics: (s) => this.haptics(s) };
  }
}
