/** Plain-language consent sheet text per scope ("Budget wants to read your contacts"). */
export interface ConsentCopy {
  action: string;
  detail: string;
}

const COPY: Record<string, ConsentCopy> = {
  'device.health.read': {
    action: 'read your health data',
    detail: 'Activity, calories burned, sleep, weight and nutrition from Health Connect. Android will then ask which of these to share. Readings stay on your phone and server.',
  },
  'device.health.write': {
    action: 'save to Health Connect',
    detail: 'Meals, weight and water you log in this app are written to Health Connect, so your watch and other health apps see them.',
  },
  'device.location': { action: 'use your location', detail: 'Your current position, each time the app asks.' },
  'device.contacts.read': { action: 'read your contacts', detail: "Names, phone numbers and emails from this phone's address book." },
  'files.read': { action: 'open your files and photos', detail: 'Only the files you pick.' },
  'files.write': { action: 'save files', detail: 'Files are stored on your server.' },
  'notify.post': { action: 'send you notifications', detail: 'Reminders and alerts from this app.' },
  'home.control': { action: 'control your home', detail: 'Turn devices on and off through Home Assistant.' },
  'apps.launch': { action: 'open other apps', detail: 'Launch apps installed on this phone.' },
  'ai.chat': { action: 'use Claude', detail: 'Messages are sent to Claude through your server.' },
};

export function consentCopy(scope: string): ConsentCopy {
  return COPY[scope] ?? { action: `use ${scope}`, detail: 'This permission is not described yet.' };
}

/** Short label for Settings → Permissions rows. */
export function scopeLabel(scope: string): string {
  const c = COPY[scope];
  return c ? c.action.charAt(0).toUpperCase() + c.action.slice(1) : scope;
}
