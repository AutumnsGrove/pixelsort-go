// Getting a picture from a file into the RGBA working copy the engine sorts.

/** Size of the working copy: the long edge is capped, the aspect is kept, nothing is upscaled (PLAN.md P3). */
export function workingSize(w: number, h: number, longEdge: number): { w: number; h: number; scaled: boolean } {
	const k = Math.min(1, longEdge / Math.max(w, h));
	return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: k < 1 };
}

/** The long edge for this device: 1280 on a phone-sized screen, 1920 otherwise. */
export function defaultLongEdge(): number {
	const small = matchMedia('(max-width: 700px)').matches;
	const weak = navigator.hardwareConcurrency <= 4 && /Mobi/.test(navigator.userAgent);
	return small || weak ? 1280 : 1920;
}

export class NotAnImage extends Error {
	constructor(name: string) {
		super(`"${name}" is not an image the browser can read.`);
		this.name = 'NotAnImage';
	}
}

export type Decoded = { w: number; h: number; rgba: Uint8ClampedArray; sourceW: number; sourceH: number };

/** Decodes a file (respecting EXIF orientation) and scales it to the working size. */
export async function decodeFile(file: Blob & { name?: string }, longEdge: number): Promise<Decoded> {
	if (file.type && !file.type.startsWith('image/')) throw new NotAnImage(file.name ?? 'that file');
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		throw new NotAnImage(file.name ?? 'that file');
	}
	const size = workingSize(bitmap.width, bitmap.height, longEdge);
	const canvas = new OffscreenCanvas(size.w, size.h);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('This browser cannot create a canvas.');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, 0, 0, size.w, size.h);
	const data = ctx.getImageData(0, 0, size.w, size.h);
	const out: Decoded = { w: size.w, h: size.h, rgba: data.data, sourceW: bitmap.width, sourceH: bitmap.height };
	bitmap.close();
	return out;
}
