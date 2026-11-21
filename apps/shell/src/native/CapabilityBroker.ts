/**
 * The only module that imports Capacitor plugins (spec implementation note 2; enforced by ESLint
 * `no-restricted-imports`). Every native call goes through here so that:
 *   - subapps never touch the device directly,
 *   - the same shell runs on web (E2E, dev) and on other form factors with capabilities discovered,
 *     not assumed (spec principle "device-agnostic contracts").
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { Capabilities, FormFactor } from '@superapp/contracts';

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

  /** What exists on this hardware (not what any app is granted). */
  deviceCapabilities(): Capabilities['device'] {
    const native = this.isNative;
    return {
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
}
