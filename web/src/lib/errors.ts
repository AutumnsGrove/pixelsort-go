// One catalog of failures, so every one says three things: what happened, what is still safe, and what to do next.
// Never a raw exception: technical detail lives behind "Details". Port of mockups/shared/errors.js (the pure part;
// the dialog and banner are Svelte components that render `describe()` as text, never as HTML).

export type ErrorCode =
	| 'image-unreadable'
	| 'image-too-big'
	| 'link-blocked'
	| 'link-not-image'
	| 'link-too-large'
	| 'link-timeout'
	| 'engine-failed'
	| 'engine-download-failed'
	| 'engine-crashed'
	| 'export-oom'
	| 'save-failed'
	| 'share-failed';
export type ActionId = 'choose' | 'close' | 'save-and-drop' | 'retry' | 'reload' | 'restart' | 'smaller' | 'back';
export type ErrorAction = { id: ActionId; label: string; primary?: boolean };
export type ErrorView = {
	code: ErrorCode | 'unknown';
	tone: 'warn' | 'error';
	title: string;
	body: string;
	safe: string;
	actions: ErrorAction[];
};
export type ErrorContext = {
	name?: string;
	mp?: number;
	max?: number;
	device?: string;
	kind?: string;
	mb?: number;
	band?: number | null;
	bands?: number | null;
	size?: string;
	scale?: number;
	reason?: string;
};

const num = (n: unknown, unit: string, fallback: string): string =>
	typeof n === 'number' && Number.isFinite(n) ? `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${unit}` : fallback;
const mb = (n: unknown) => num(n, 'MB', 'a lot');
const mp = (n: unknown) => num(n, 'MP', 'a very large picture');

type Entry = Omit<ErrorView, 'code'>;
const close = (label = 'Close'): ErrorAction => ({ id: 'close', label });

// Each entry is a function of the context, so missing fields degrade to plain words, never "undefined".
export const CATALOG: Record<ErrorCode, (c: ErrorContext) => Entry> = {
	'image-unreadable': (c) => ({
		tone: 'warn',
		title: 'That isn’t a picture I can read.',
		body:
			(c.name ? `“${c.name}” ` : 'That file ') + 'doesn’t open as an image. It may be damaged, or not an image at all.',
		safe: 'Your current picture and settings are untouched.',
		actions: [{ id: 'choose', label: 'Choose another', primary: true }, close('Keep what I have')]
	}),
	'image-too-big': (c) => ({
		tone: 'warn',
		title: 'That picture is too large to open here.',
		body: `It is ${mp(c.mp)}; this ${c.device ?? 'device'} can open up to ${mp(c.max)}. Opening it would run the browser out of memory.`,
		safe: 'Nothing was changed.',
		actions: [{ id: 'choose', label: 'Choose a smaller one', primary: true }, close('Cancel')]
	}),
	'link-blocked': () => ({
		tone: 'warn',
		title: 'That site won’t let me fetch the picture.',
		body: 'The site blocks direct loads, and the relay couldn’t get it either. Some sites refuse anything that isn’t a browser tab.',
		safe: 'Nothing was loaded and nothing left your network.',
		actions: [{ id: 'save-and-drop', label: 'Save it, then drop the file here', primary: true }, close()]
	}),
	'link-not-image': (c) => ({
		tone: 'warn',
		title: 'That link isn’t a picture.',
		body: `It opened a ${c.kind ?? 'web page'}, not an image. Try the picture’s own address (right-click it, then copy image address).`,
		safe: 'Nothing was loaded.',
		actions: [{ id: 'retry', label: 'Try another link', primary: true }, close()]
	}),
	'link-too-large': (c) => ({
		tone: 'warn',
		title: 'That picture is bigger than the relay allows.',
		body: `It is about ${mb(c.mb)}; the relay stops at ${mb(c.max ?? 40)}. Pictures loaded straight from a site have no such limit — so downloading it and dropping the file in will work.`,
		safe: 'Nothing was loaded.',
		actions: [{ id: 'save-and-drop', label: 'Download it, then drop the file', primary: true }, close()]
	}),
	'link-timeout': () => ({
		tone: 'warn',
		title: 'The site took too long to answer.',
		body: 'The relay waited 15 seconds. The site may be slow or down.',
		safe: 'Nothing was loaded.',
		actions: [{ id: 'retry', label: 'Try again', primary: true }, close()]
	}),
	'engine-failed': () => ({
		tone: 'error',
		title: 'The sorting engine didn’t start.',
		body: 'The part that does the sorting couldn’t load. This is usually a flaky connection, or a browser that is too old to run it.',
		safe: 'Your pictures, runs and settings are fine — only the sorter is missing.',
		actions: [
			{ id: 'retry', label: 'Try again', primary: true },
			{ id: 'reload', label: 'Reload the page' }
		]
	}),
	'engine-download-failed': () => ({
		tone: 'error',
		title: 'The sorting engine didn’t finish downloading.',
		body: 'It is a few megabytes and the connection dropped or went too quiet while it came down, even after trying again.',
		safe: 'Your picture, runs and settings are fine — only the sorter is missing, and Try again keeps your picture.',
		actions: [
			{ id: 'retry', label: 'Try again', primary: true },
			{ id: 'reload', label: 'Reload the page' }
		]
	}),
	'engine-crashed': () => ({
		tone: 'error',
		title: 'The sorter stopped unexpectedly.',
		body: 'It hit a problem partway through and was shut down so it couldn’t take the page with it.',
		safe: 'Your picture and every setting are still here.',
		actions: [{ id: 'restart', label: 'Restart the sorter', primary: true }, close()]
	}),
	'export-oom': (c) => ({
		tone: 'error',
		title: 'The export ran out of memory.',
		body:
			`It stopped at band ${c.band ?? '?'} of ${c.bands ?? '?'} when this ${c.device ?? 'device'} couldn’t hold any more.` +
			(c.size ? ` ${c.size} was too much.` : ''),
		safe: 'Your run is saved in the Archive; nothing was written to disk.',
		actions: [
			{
				id: 'smaller',
				label: c.scale ? `Export at ${Math.round(c.scale * 100)}% instead` : 'Export smaller',
				primary: true
			},
			{ id: 'back', label: 'Back to options' }
		]
	}),
	'save-failed': (c) => ({
		tone: 'warn',
		title: 'Couldn’t save this run to the Archive.',
		body:
			c.reason === 'disk'
				? 'The server says its disk is full.'
				: `The server didn’t accept it${c.reason === 'timeout' ? ' in time.' : '.'}`,
		safe: 'Your picture and settings are still here. Try again whenever you like. Exporting still works.',
		actions: [{ id: 'retry', label: 'Retry now', primary: true }, close('Dismiss')]
	}),
	'share-failed': (c) => ({
		tone: 'warn',
		title: 'Couldn’t make the link.',
		body:
			c.reason === 'quota'
				? 'The shared bucket is full. Revoke an old shared album to make room.'
				: 'Your Worker didn’t answer, so nothing was uploaded.',
		safe: 'Nothing was shared and your runs are untouched.',
		actions: [{ id: 'retry', label: 'Try again', primary: true }, close()]
	})
};

const FALLBACK: Entry = {
	tone: 'error',
	title: 'Something went wrong.',
	body: 'That didn’t work, and I don’t have a specific reason to give you.',
	safe: 'Your picture and settings are untouched.',
	actions: [{ id: 'close', label: 'Close', primary: true }]
};

export function describe(code: string, ctx: ErrorContext = {}): ErrorView {
	const make = (CATALOG as Record<string, (c: ErrorContext) => Entry>)[code];
	return make ? { code: code as ErrorCode, ...make(ctx) } : { code: 'unknown', ...FALLBACK };
}

/** Map an engine failure to a catalog code: the UI never shows a raw string (it goes behind "Details"). */
export function engineErrorCode(err: unknown): 'engine-failed' | 'engine-crashed' | 'engine-download-failed' {
	if (err instanceof Error && err.name === 'EngineCrashed') return 'engine-crashed';
	if (err instanceof Error && err.name === 'EngineDownloadFailed') return 'engine-download-failed';
	return 'engine-failed';
}
