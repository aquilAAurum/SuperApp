import type { FormFactor } from './envelope.ts';

/** Result of `sys.capabilities`: what exists on this device, so subapps feature-detect (spec §Versioning). */
export interface Capabilities {
  apiVersion: string;
  shellVersion: string;
  formFactor: FormFactor;
  platform: 'android' | 'web';
  /** Implemented bridge methods on this shell build. */
  methods: string[];
  /** Device capabilities present on this hardware/OS (not whether the app is granted them). */
  device: {
    location: boolean;
    contacts: boolean;
    haptics: boolean;
    battery: boolean;
    network: boolean;
    camera: boolean;
    notifications: boolean;
    /** Health Connect is installed and usable (ADR-010; absent on shells before API 1.1). */
    health?: boolean;
  };
}
