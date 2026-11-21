import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.superapp.shell',
  appName: 'Super app',
  webDir: 'dist',
  android: {
    // Release builds must not be debuggable from Chrome DevTools.
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // Top-level navigation stays inside the shell; external URLs open via the launcher (M4).
    allowNavigation: [],
  },
};

export default config;
