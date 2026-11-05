// The reactive settings store: reads and writes through the storage seam, and applies the look-and-feel settings
// (grain, motion) to <html> so a change shows on every screen.
import { DEFAULTS, sanitize, type Settings } from './settings';
import { LocalStorageBackend, type KeyValueStore } from './storage';

const KEY = 'pixelsort.settings';
const backend: KeyValueStore = new LocalStorageBackend();

export const settings = $state<Settings>({ ...DEFAULTS, ...sanitize(backend.get(KEY)) });

export function applySettings(): void {
	if (typeof document === 'undefined') return;
	const h = document.documentElement;
	h.dataset.grain = settings.grain ? 'on' : 'off';
	if (settings.motion === 'reduce') h.dataset.motion = 'reduce';
	else delete h.dataset.motion;
}

export function updateSettings(patch: Partial<Settings>): void {
	Object.assign(settings, sanitize(patch));
	backend.set(KEY, { ...settings });
	applySettings();
}

export function resetSettings(): void {
	Object.assign(settings, DEFAULTS);
	backend.remove(KEY);
	applySettings();
}
