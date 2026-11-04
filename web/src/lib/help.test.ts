import { expect, test } from 'vitest';
import { SHORTCUTS, flat, shortcutFor } from './help';

test('no duplicate ids or keys', () => {
	const items = flat();
	expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
	const keys = items.flatMap((i) => i.keys);
	expect(new Set(keys).size).toBe(keys.length);
});
test('every entry in the sheet resolves to its own shortcut id from a real key press', () => {
	for (const g of SHORTCUTS)
		for (const item of g.items)
			for (const key of item.keys) {
				const press = key === 'Space' ? ' ' : key;
				expect(shortcutFor({ key: press, target: { tagName: 'BODY' } }), `${item.id} (${key})`).toBe(item.id);
			}
});
test('typing in a field triggers nothing but Escape; modifier combos are left to the browser', () => {
	expect(shortcutFor({ key: 'r', target: { tagName: 'INPUT' } })).toBeNull();
	expect(shortcutFor({ key: 'e', target: { tagName: 'TEXTAREA' } })).toBeNull();
	expect(shortcutFor({ key: 'e', target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
	expect(shortcutFor({ key: 'Escape', target: { tagName: 'INPUT' } })).toBe('esc');
	expect(shortcutFor({ key: 'r', metaKey: true })).toBeNull();
	expect(shortcutFor({ key: 'r', ctrlKey: true })).toBeNull();
	expect(shortcutFor({ key: 'x' })).toBeNull();
});
test('capital letters count (Caps Lock, Shift)', () => expect(shortcutFor({ key: 'R' })).toBe('restart'));
