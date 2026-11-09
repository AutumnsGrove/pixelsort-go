// Just the parts of gifenc (MIT) the animation export uses. It ships no types.
declare module 'gifenc' {
	export type Palette = number[][];
	export function quantize(
		rgba: Uint8Array | Uint8ClampedArray,
		maxColors: number,
		opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean; clearAlpha?: boolean }
	): Palette;
	export function applyPalette(
		rgba: Uint8Array | Uint8ClampedArray,
		palette: Palette,
		format?: 'rgb565' | 'rgb444' | 'rgba4444'
	): Uint8Array;
	export type GIFEncoderInstance = {
		writeFrame(
			index: Uint8Array,
			width: number,
			height: number,
			opts?: { palette?: Palette; delay?: number; repeat?: number; dispose?: number; colorDepth?: number }
		): void;
		finish(): void;
		bytes(): Uint8Array;
		reset(): void;
	};
	export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GIFEncoderInstance;
}
