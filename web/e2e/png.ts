import { deflateSync } from 'node:zlib';

const table = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc = (b: Buffer) => {
	let c = 0xffffffff;
	for (const x of b) c = table[(c ^ x) & 255]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type), data]);
	const sum = Buffer.alloc(4);
	sum.writeUInt32BE(crc(body));
	return Buffer.concat([len, body, sum]);
}

/** A small valid grayscale PNG whose pixels depend on `n`, so every image has its own hash. */
export function makePng(n: number, size = 16): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 0; // grayscale
	const rows: number[] = [];
	for (let y = 0; y < size; y++) {
		rows.push(0);
		for (let x = 0; x < size; x++) rows.push((x * 7 + y * 13 + n * 31) & 255);
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(Buffer.from(rows))),
		chunk('IEND', Buffer.alloc(0))
	]);
}
