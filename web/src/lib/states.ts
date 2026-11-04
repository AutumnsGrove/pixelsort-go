// App states that are not "everything is fine": storage near or over the budget, and the server out of reach. One place
// decides what each screen says. PLAN.md section 6: the meter warns at 80 %; at 100 % new runs still save but the
// warning is loud; nothing is ever auto-deleted. Port of mockups/shared/states.js (pure parts).

export const WARN_AT = 0.8;

export type UsageLevel = 'ok' | 'warn' | 'full';
export function usage(
	usedGB: number,
	budgetGB = 50
): { used: number; budget: number; frac: number; pct: number; level: UsageLevel } {
	const frac = usedGB / budgetGB;
	return {
		used: usedGB,
		budget: budgetGB,
		frac,
		pct: Math.floor(frac * 100 + 1e-9),
		level: frac >= 1 ? 'full' : frac >= WARN_AT ? 'warn' : 'ok'
	};
}

export type StatusState = { used?: number | null; budget?: number; offline?: boolean };
export type Status = { kind: 'offline' | 'full' | 'warn'; text: string; sub: string; action: string };

/** What to tell the person, or null when all is well. Offline outranks storage: it is the one that stops work. */
export function status(
	state: StatusState,
	o: { surface?: 'studio' | 'archive'; pending?: number } = {}
): Status | null {
	const u = usage(state.used ?? 0, state.budget);
	const g = (n: number) => n.toFixed(1);
	if (state.offline) {
		const pending = o.pending ?? 0;
		return o.surface === 'archive'
			? {
					kind: 'offline',
					text: 'Can’t reach your server.',
					sub: 'Showing what this browser kept. Looking is fine; saving, sending and deleting wait until it’s back.',
					action: 'Retry'
				}
			: {
					kind: 'offline',
					text: 'Offline — sorting still works.',
					sub: `${pending} run${pending === 1 ? '' : 's'} will save when the server is back.`,
					action: 'Retry'
				};
	}
	if (u.level === 'full')
		return {
			kind: 'full',
			text: `The Archive is full — ${g(u.used)} of ${u.budget} GB.`,
			sub: 'New runs still save and nothing is deleted. Free up some space when you can.',
			action: 'Free up space'
		};
	if (u.level === 'warn')
		return {
			kind: 'warn',
			text: `The Archive is ${u.pct}% full — ${g(u.used)} of ${u.budget} GB.`,
			sub: 'Nothing is deleted automatically.',
			action: 'Free up space'
		};
	return null;
}

/** Meter segments (GB): results, originals, thumbs, bin. They sum to `used` and are never negative. */
export function segments(
	used: number,
	binGB = 1.4
): { results: number; originals: number; thumbs: number; bin: number } {
	const bin = Math.min(binGB, used);
	const rest = used - bin;
	const thumbs = rest * 0.04;
	const originals = rest * 0.2;
	return { results: rest - thumbs - originals, originals, thumbs, bin };
}
