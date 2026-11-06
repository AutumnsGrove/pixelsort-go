// When and how a run is saved. Pure rules, so the Studio store, the dock and the tests agree.
//
// Decision (replaces "auto-save every run", D8): nothing is stored until the person presses Save (or exports). The
// "Auto-save runs" setting, off by default, brings the old behaviour back for people who want it.
import { ApiError } from './api';

/** A run is stored by itself only when the setting is on and the picture is something the person brought, not the demo. */
export function autoSaveAllowed(o: { autoSave: boolean; isSample: boolean }): boolean {
	return o.autoSave && !o.isSample;
}

export type SaveState = 'unsaved' | 'saved' | 'saving' | 'failed';

/** The Save button's label, whether it is off, and a title for hover and screen readers. */
export function saveButton(state: SaveState, sorting: boolean): { label: string; disabled: boolean; title: string } {
	if (state === 'saving') return { label: 'Saving…', disabled: true, title: 'Saving this look to the Archive…' };
	if (sorting)
		return {
			label: state === 'failed' ? 'Retry save' : state === 'saved' ? 'Saved' : 'Save',
			disabled: true,
			title: 'The sort is still running. Save once it has finished or you pause it.'
		};
	if (state === 'saved')
		return {
			label: 'Saved',
			disabled: false,
			title: 'This look is in the Archive. Change something to save a new one.'
		};
	if (state === 'failed')
		return { label: 'Retry save', disabled: false, title: 'The last save did not go through. Try again.' };
	return { label: 'Save', disabled: false, title: 'Save this look to the Archive' };
}

/**
 * Warns the first time someone leaves with changes that were never saved, then lets them go. `key` identifies the current
 * look: a further change earns a fresh warning, and saving (dirty false) resets it. It never blocks twice.
 */
export function createLeaveGuard(): { check(dirty: boolean, key: string): 'allow' | 'warn' } {
	let warnedFor: string | null = null;
	return {
		check(dirty, key) {
			if (!dirty) {
				warnedFor = null;
				return 'allow';
			}
			if (warnedFor === key) return 'allow';
			warnedFor = key;
			return 'warn';
		}
	};
}

/** What the error catalog should say about a failed save. Only a full disk and a timeout are worth naming. */
export function saveFailureReason(e: unknown): 'disk' | 'timeout' | undefined {
	if (!(e instanceof ApiError)) return undefined;
	if (e.status === 507) return 'disk';
	if (e.status === 408 || e.status === 504) return 'timeout';
	return undefined;
}
