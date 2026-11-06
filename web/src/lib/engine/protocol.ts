// Messages between the page and the engine worker. Every request has an id; the worker answers each with the
// same id, in order.

import type { Speed } from './animator';

export type Stats = { lines: number; intervals: number; sortable: number; frozen: number };
export type Timings = { prepareMs: number; sortMs: number; transferMs: number };

export type Request =
	| { id: number; type: 'init'; w: number; h: number }
	| { id: number; type: 'setImage'; rgba: ArrayBuffer }
	| { id: number; type: 'setRegions'; labels: ArrayBuffer | null; classOf: ArrayBuffer | null; defsJson: string | null }
	| { id: number; type: 'setMask'; mask: ArrayBuffer | null }
	| { id: number; type: 'setSoft'; radius: number }
	| { id: number; type: 'setTiling'; specJson: string | null; defsJson: string | null } // answers with labels + classOf
	| { id: number; type: 'setMaskSpec'; specJson: string | null }
	| { id: number; type: 'brightestSpot' }
	| { id: number; type: 'histogram'; key: string } // counts per 0..255 value of a sort key
	| { id: number; type: 'caRules' } // the recommended cellular-automaton rules with notes
	| { id: number; type: 'caPreview'; json: string; rule: number } // what one cellular rule looks like with this recipe
	| { id: number; type: 'sortable' } // 1 per pixel the current recipe lets move
	| { id: number; type: 'configure'; json: string }
	| { id: number; type: 'run'; transfer?: 'copy' | 'view' }
	| { id: number; type: 'animate'; speed: Speed } // prepare, reset and start streaming frames
	| { id: number; type: 'pause' }
	| { id: number; type: 'resume' }
	| { id: number; type: 'setSpeed'; speed: Speed }
	| { id: number; type: 'restart' } // back to the original pixels, keep animating
	| { id: number; type: 'seek'; pass: number } // pause, jump to the state after `pass` passes, answer with those pixels
	| { id: number; type: 'ack' }; // the page drew the last frame; no reply

export type Response =
	| {
			id: number;
			ok: true;
			stats?: Stats;
			rgba?: ArrayBuffer;
			timings?: Timings;
			labels?: ArrayBuffer; // Uint16Array region label per pixel (setTiling)
			classOf?: ArrayBuffer; // Uint8Array class per cell id (setTiling)
			spot?: { cx: number; cy: number; w: number; h: number };
			counts?: number[];
			rules?: { rule: number; note: string }[];
			mask?: ArrayBuffer; // Uint8Array, 1 = can move (sortable); or the preview's 0/1 cells (caPreview)
			preview?: { w: number; h: number }; // the size of the caPreview mask
			seek?: { pass: number; progress: number; done: boolean }; // with rgba, for a seek
	  }
	| {
			id: number;
			ok: false;
			error: string;
			/** Set when the engine file itself could not be downloaded (as opposed to the engine failing after it loaded). */
			download?: { attempts: number; reason: string; url: string };
	  };

/** Not tied to a request: the worker streams one after each batch of passes, at most one unacknowledged. */
export type FrameEvent = {
	event: 'frame';
	rgba: ArrayBuffer;
	progress: number;
	pass: number;
	done: boolean;
	stepMs: number;
};

/**
 * Not tied to a request: the worker tells the page how the engine download is going, so Studio can say "loading the
 * engine" instead of sitting silently. `loaded` is the last one, sent once the engine is running.
 */
export type LoadingEvent =
	{ event: 'loading'; loaded: number; total: number | null; attempt: number } | { event: 'loaded' };
