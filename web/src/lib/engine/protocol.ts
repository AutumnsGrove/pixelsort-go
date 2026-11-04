// Messages between the page and the engine worker. Every request has an id; the worker answers each with the
// same id, in order.

export type Stats = { lines: number; intervals: number; sortable: number; frozen: number };
export type Timings = { prepareMs: number; sortMs: number; transferMs: number };

export type Request =
	| { id: number; type: 'init'; w: number; h: number }
	| { id: number; type: 'setImage'; rgba: ArrayBuffer }
	| { id: number; type: 'setRegions'; labels: ArrayBuffer | null; classOf: ArrayBuffer | null; defsJson: string | null }
	| { id: number; type: 'setMask'; mask: ArrayBuffer | null }
	| { id: number; type: 'setSoft'; radius: number }
	| { id: number; type: 'configure'; json: string }
	| { id: number; type: 'run'; transfer?: 'copy' | 'view' };

export type Response =
	| { id: number; ok: true; stats?: Stats; rgba?: ArrayBuffer; timings?: Timings }
	| { id: number; ok: false; error: string };
