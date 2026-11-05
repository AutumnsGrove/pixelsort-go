// Pure helpers for the angle dial. Angles are whole degrees 0..359: 0 sorts left to right, 90 bottom to top,
// 180 right to left, 270 top to bottom (decision E3). Screen y grows downward, hence the flip in fromPointer.

/** Wrap any integer into 0..359. */
export const wrap = (a: number): number => ((Math.round(a) % 360) + 360) % 360;

/** Snap to the nearest multiple of 15 degrees (halves round up). */
export const snap15 = (a: number): number => wrap(Math.round(a / 15) * 15);

/** The angle of the pointer around the dial centre. */
export function fromPointer(cx: number, cy: number, x: number, y: number): number {
	return wrap((Math.atan2(cy - y, x - cx) * 180) / Math.PI);
}
