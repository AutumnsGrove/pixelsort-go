// An animation waiting to be saved belongs to the look it was exported from. If the recipe or picture changes before the
// save goes through, the animation must not ride along with the new run.
export type PendingAnimation = {
	blob: Blob;
	/** The studio save key at the moment of export. */
	key: string;
	/** The exported animation's own size, which may be scaled down from the still. */
	w: number;
	h: number;
};

/** The pending animation when it belongs to this look, or null. */
export function pendingFor(pending: PendingAnimation | null, key: string): PendingAnimation | null {
	return pending && pending.key === key ? pending : null;
}
