export const MAX_IMAGES = 200;
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_OBJECT_BYTES = 30 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const isAlbumId = (s: string): boolean => /^[a-z2-7]{26}$/.test(s);

/** An integer 0..199 written the plain way (no sign, no leading zeros). */
export const isIndex = (s: string): boolean => /^(0|[1-9]\d{0,2})$/.test(s) && Number(s) < MAX_IMAGES;

export const isImageType = (s: string | null): boolean => !!s && (IMAGE_TYPES as readonly string[]).includes(s.split(';')[0].trim());

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Returns an error message, or null when the manifest is acceptable. Text fields are data; escaping happens at render. */
export function manifestError(text: string): string | null {
	if (new TextEncoder().encode(text).length > MAX_MANIFEST_BYTES) return 'manifest too large';
	let m: unknown;
	try {
		m = JSON.parse(text);
	} catch {
		return 'manifest is not JSON';
	}
	if (!isObject(m)) return 'manifest must be an object';
	if (m.v !== 1) return 'unsupported manifest version';
	if (!isNum(m.created)) return 'created must be a number';
	if (m.expires !== null && !isNum(m.expires)) return 'expires must be a number or null';
	if (m.title !== undefined && typeof m.title !== 'string') return 'title must be text';
	if (!Array.isArray(m.images) || m.images.length === 0) return 'images must be a non-empty list';
	if (m.images.length > MAX_IMAGES) return `at most ${MAX_IMAGES} images`;
	for (const img of m.images) {
		if (!isObject(img)) return 'each image must be an object';
		if (!isNum(img.w) || !isNum(img.h)) return 'each image needs w and h';
		if (typeof img.mime !== 'string' || !(IMAGE_TYPES as readonly string[]).includes(img.mime)) return 'bad image mime';
		if (img.name !== undefined && (typeof img.name !== 'string' || [...img.name].length > 60)) return 'name must be text of 60 characters or fewer';
		if (img.recipe !== undefined && !isObject(img.recipe)) return 'recipe must be an object';
	}
	return null;
}
