import { EFF_LARGE_WORDLIST } from 'eff-large-wordlist';

// Unbiased random integer in [0, max) using rejection sampling over crypto bytes.
// (`x % max` alone biases toward small values when max does not divide 2^32.)
function secureRandomInt(max: number): number {
	if (max <= 0) throw new Error('max must be positive');
	const limit = Math.floor(0x1_0000_0000 / max) * max;
	const buf = new Uint32Array(1);
	let x: number;
	do {
		crypto.getRandomValues(buf);
		x = buf[0] ?? 0;
	} while (x >= limit);
	return x % max;
}

// Generate a diceware-style passphrase from the EFF large wordlist. Default is a
// space separator because some EFF words contain hyphens (e.g. "t-shirt"), which
// would make "-" an ambiguous delimiter. Six words give ~77.5 bits of entropy.
export function generateDicewarePassphrase(words = 6, separator = ' '): string {
	const out: string[] = [];
	for (let i = 0; i < words; i++) {
		out.push(EFF_LARGE_WORDLIST[secureRandomInt(EFF_LARGE_WORDLIST.length)] ?? '');
	}
	return out.join(separator);
}
