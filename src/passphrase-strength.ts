// zxcvbn-ts is heavy (its language dictionaries are ~1.6 MB and ~200 ms to build).
// We need it only when a user sets/changes a passphrase, so the packages are pulled
// in via dynamic import() rather than a static top-level import. In esbuild's cjs
// output this keeps the dictionary literals inside a lazily-invoked init function, so
// they are neither parsed nor constructed at plugin load. Call warmPassphraseStrength()
// when a create/change UI opens to hide the one-time build cost behind the modal open.

// Minimum acceptable zxcvbn score (0-4). 3 = "safely unguessable: moderate
// protection from offline slow-hash scenario". This is the primary defense for
// passphrase mode: PBKDF2 (the fallback KDF) is GPU-friendly, so a high-entropy
// passphrase is what makes an encrypted secrets file infeasible to crack.
export const MIN_PASSPHRASE_SCORE = 3;

export interface PassphraseStrength {
	score: number; // 0-4
	warning: string;
	suggestions: string[];
}

let zxcvbnImpl: typeof import('@zxcvbn-ts/core').zxcvbn | null = null;
let loading: Promise<void> | null = null;

async function loadZxcvbn(): Promise<void> {
	const [core, common, en] = await Promise.all([
		import('@zxcvbn-ts/core'),
		import('@zxcvbn-ts/language-common'),
		import('@zxcvbn-ts/language-en'),
	]);
	core.zxcvbnOptions.setOptions({
		dictionary: {
			...common.dictionary,
			...en.dictionary,
		},
		graphs: common.adjacencyGraphs,
		translations: en.translations,
	});
	zxcvbnImpl = core.zxcvbn;
}

async function ensureLoaded(): Promise<void> {
	if (zxcvbnImpl) return;
	if (!loading) loading = loadZxcvbn();
	try {
		await loading;
	} catch (e) {
		loading = null; // allow a retry on the next call
		throw e;
	}
}

// Preload the estimator (call when a passphrase create/change UI opens) so the first
// keystroke doesn't pay the dictionary-build cost.
export function warmPassphraseStrength(): void {
	void ensureLoaded();
}

export async function evaluatePassphrase(passphrase: string): Promise<PassphraseStrength> {
	await ensureLoaded();
	const result = zxcvbnImpl!(passphrase);
	return {
		score: result.score,
		warning: result.feedback.warning ?? '',
		suggestions: result.feedback.suggestions,
	};
}

export async function isPassphraseAcceptable(passphrase: string): Promise<boolean> {
	return (await evaluatePassphrase(passphrase)).score >= MIN_PASSPHRASE_SCORE;
}
