/**
 * Scope vocabulary (spec §Permissions). Scopes are granted by the shell to subapps; Android
 * permissions are granted to the shell. Parameterised scopes:
 *   core.<collection>.read|write, bus.emit:<topic>, bus.listen:<topic>
 */
export const STATIC_SCOPES = [
  'data.own',
  'nav.open',
  'apps.launch',
  'files.read',
  'files.write',
  'notify.post',
  'device.info',
  'device.battery',
  'device.network',
  'device.location',
  'device.contacts.read',
  'device.haptics',
  'home.read',
  'home.control',
  'media.read',
  'media.play',
  'ai.chat',
] as const;

/** Reserved for later milestones; a v1 manifest may not request them. */
export const RESERVED_SCOPES = [
  'gdrive.read',
  'gdrive.write',
  'device.calllog.read',
  'device.sms.read',
  'device.usage.read',
  'device.health.read',
] as const;

export type StaticScope = (typeof STATIC_SCOPES)[number];

/** Scopes that need a user consent decision (sheet) before first use. Others are granted by declaring them. */
export const CONSENT_SCOPES: ReadonlySet<string> = new Set([
  'device.location',
  'device.contacts.read',
  'files.read',
  'files.write',
  'notify.post',
  'home.control',
  'apps.launch',
  'ai.chat',
]);

const CORE_COLLECTION_SCOPE = /^core\.[a-z][a-z_]*\.(read|write)$/;
const BUS_SCOPE = /^bus\.(emit|listen):[a-z][a-z0-9_.]*$/;

export function isKnownScope(scope: unknown): scope is string {
  if (typeof scope !== 'string') return false;
  return (
    (STATIC_SCOPES as readonly string[]).includes(scope) ||
    CORE_COLLECTION_SCOPE.test(scope) ||
    BUS_SCOPE.test(scope)
  );
}

export function isReservedScope(scope: string): boolean {
  return (RESERVED_SCOPES as readonly string[]).includes(scope);
}
