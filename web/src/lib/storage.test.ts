import { describe, expect, test } from 'vitest';
import { LocalStorageBackend, MemoryBackend } from './storage';

function fakeStorage(init: Record<string, string> = {}) {
	const data = { ...init };
	return {
		data,
		getItem: (k: string) => data[k] ?? null,
		setItem: (k: string, v: string) => void (data[k] = v),
		removeItem: (k: string) => void delete data[k]
	};
}

describe('LocalStorageBackend', () => {
	test('round-trips JSON', () => {
		const s = fakeStorage();
		const b = new LocalStorageBackend(() => s);
		expect(b.set('a', { x: [1, 2] })).toBe(true);
		expect(b.get('a')).toEqual({ x: [1, 2] });
		b.remove('a');
		expect(b.get('a')).toBeNull();
	});
	test('a damaged value reads as the default (null), never throws', () => {
		const b = new LocalStorageBackend(() => fakeStorage({ a: '{nope' }));
		expect(b.get('a')).toBeNull();
	});
	test('set returns false instead of throwing when storage is full or unavailable', () => {
		const full = {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
			removeItem: () => {
				throw new Error('denied');
			}
		};
		const b = new LocalStorageBackend(() => full);
		expect(b.set('a', 1)).toBe(false);
		expect(() => b.remove('a')).not.toThrow();
		expect(new LocalStorageBackend(() => null).set('a', 1)).toBe(false);
		expect(new LocalStorageBackend(() => null).get('a')).toBeNull();
	});
});

test('MemoryBackend behaves the same way', () => {
	const m = new MemoryBackend();
	expect(m.get('a')).toBeNull();
	m.set('a', [1]);
	expect(m.get('a')).toEqual([1]);
	m.remove('a');
	expect(m.get('a')).toBeNull();
});
