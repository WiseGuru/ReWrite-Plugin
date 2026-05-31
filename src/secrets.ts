import { normalizePath, Platform, Plugin } from 'obsidian';
import { argon2id } from 'hash-wasm';
import { isPassphraseAcceptable } from 'passphrase-strength';

const SECRETS_FILE = 'secrets.json.nosync';
const SECRETS_VERSION = 2;
const VERIFIER_PLAINTEXT = 'rewrite-passphrase-verifier-v1';
const SAFE_STORAGE_SELFTEST = 'rewrite-safestorage-selftest';
const PBKDF2_ITERATIONS = 600_000;
const KDF_SALT_BYTES = 16;
const AES_IV_BYTES = 12;
const VALUE_SEP = '.';

// Argon2id parameters for new passphrase envelopes. Memory is capped at 32 MiB so
// the weakest supported phone (params live in the ciphertext and must reproduce on
// every device that opens the synced vault) can still allocate and unlock within the
// ~0.5-1s budget. Higher would risk allocation failure on low-RAM mobile webviews.
const ARGON2_MEM_KIB = 32_768; // 32 MiB
const ARGON2_TIME = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_BYTES = 32;

export type EncryptionMode = 'safeStorage' | 'passphrase';

export interface EncryptionStatus {
	mode: EncryptionMode;
	// passphrase mode with a derived key not yet held in memory this session.
	locked: boolean;
	// passphrase mode that has actually had a passphrase set (kdf + verifier on disk).
	// false = first run on a no-keychain device: prompt to CREATE a passphrase, not unlock.
	configured: boolean;
	// OS keychain present, verified by a round-trip self-test, and not a known-insecure backend.
	safeStorageAvailable: boolean;
	// OS keychain reports available but is effectively unencrypted (e.g. Chromium basic_text)
	// or failed the round-trip; we do not offer it and steer the user to a passphrase.
	safeStorageInsecure: boolean;
	safeStorageBackend: string | null;
}

type KdfAlgo = 'pbkdf2' | 'argon2id';

interface PassphraseKdf {
	algo: KdfAlgo;
	salt: string; // base64
	// pbkdf2
	iterations?: number;
	// argon2id
	memKiB?: number;
	timeCost?: number;
	parallelism?: number;
}

interface SecretsEnvelope {
	version: number;
	mode: EncryptionMode;
	kdf?: PassphraseKdf;
	verifier?: string; // "<iv-b64>.<ct-b64>"
	keys: Record<string, string>;
}

interface SafeStorageAPI {
	isEncryptionAvailable(): boolean;
	encryptString(plain: string): { toString(encoding: string): string };
	decryptString(buf: unknown): string;
	getSelectedStorageBackend?(): string;
}

let safeStorageCache: SafeStorageAPI | null | undefined;
let verifiedSafeStorageCache: SafeStorageAPI | null | undefined;
let cachedEnvelope: SecretsEnvelope | null = null;
let unlockedKey: CryptoKey | null = null;

// Raw electron safeStorage if the platform reports encryption available. Says nothing
// about whether the backend actually encrypts (see getSafeStorage for that check).
function getRawSafeStorage(): SafeStorageAPI | null {
	if (safeStorageCache !== undefined) return safeStorageCache;
	if (!Platform.isDesktop) {
		safeStorageCache = null;
		return null;
	}
	try {
		const req =
			(window as unknown as { require?: (m: string) => unknown }).require ??
			(globalThis as unknown as { require?: (m: string) => unknown }).require;
		if (typeof req !== 'function') {
			safeStorageCache = null;
			return null;
		}
		const electron = req('electron') as { safeStorage?: SafeStorageAPI } | undefined;
		const ss = electron?.safeStorage;
		if (ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable()) {
			safeStorageCache = ss;
			return ss;
		}
	} catch {
		// fall through
	}
	safeStorageCache = null;
	return null;
}

// Verified, secure safeStorage: the backend is not the known-unencrypted Chromium
// fallback (basic_text), AND an encrypt/decrypt round-trip of a sentinel succeeds.
// Cached for the session. Used by encrypt/decrypt and the availability checks.
function getSafeStorage(): SafeStorageAPI | null {
	if (verifiedSafeStorageCache !== undefined) return verifiedSafeStorageCache;
	const raw = getRawSafeStorage();
	if (!raw) {
		verifiedSafeStorageCache = null;
		return null;
	}
	if (typeof raw.getSelectedStorageBackend === 'function') {
		let backend: string | null = null;
		try {
			backend = raw.getSelectedStorageBackend();
		} catch {
			backend = null;
		}
		// basic_text is Chromium's last-resort backend on Linux and is not encrypted.
		if (backend === 'basic_text') {
			verifiedSafeStorageCache = null;
			return null;
		}
	}
	try {
		const ct = raw.encryptString(SAFE_STORAGE_SELFTEST).toString('base64');
		const pt = raw.decryptString(base64ToNodeBuffer(ct));
		if (pt !== SAFE_STORAGE_SELFTEST) {
			verifiedSafeStorageCache = null;
			return null;
		}
	} catch {
		verifiedSafeStorageCache = null;
		return null;
	}
	verifiedSafeStorageCache = raw;
	return raw;
}

function getSafeStorageBackend(): string | null {
	const ss = getRawSafeStorage();
	if (!ss || typeof ss.getSelectedStorageBackend !== 'function') return null;
	try {
		return ss.getSelectedStorageBackend();
	} catch {
		return null;
	}
}

function secretsPath(plugin: Plugin): string {
	const dir = plugin.manifest.dir;
	if (!dir) throw new Error('Plugin manifest.dir is missing');
	return normalizePath(`${dir}/${SECRETS_FILE}`);
}

function defaultEnvelope(): SecretsEnvelope {
	// No keychain => passphrase mode, but UNCONFIGURED (no kdf/verifier). The first
	// pipeline use / settings visit prompts the user to create a passphrase. Nothing
	// is ever written in this state (saveManyKeys is a no-op while locked).
	return {
		version: SECRETS_VERSION,
		mode: getSafeStorage() ? 'safeStorage' : 'passphrase',
		keys: {},
	};
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseKdf(raw: unknown): PassphraseKdf | undefined {
	if (!isObject(raw) || typeof raw.salt !== 'string') return undefined;
	if (raw.algo === 'argon2id') {
		return {
			algo: 'argon2id',
			salt: raw.salt,
			memKiB: typeof raw.memKiB === 'number' ? raw.memKiB : ARGON2_MEM_KIB,
			timeCost: typeof raw.timeCost === 'number' ? raw.timeCost : ARGON2_TIME,
			parallelism: typeof raw.parallelism === 'number' ? raw.parallelism : ARGON2_PARALLELISM,
		};
	}
	// 'pbkdf2' or a legacy envelope with no algo field but an iterations count.
	if (typeof raw.iterations === 'number') {
		return { algo: 'pbkdf2', salt: raw.salt, iterations: raw.iterations };
	}
	return undefined;
}

function parseEnvelope(raw: string): SecretsEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return defaultEnvelope();
	}
	if (!isObject(parsed)) return defaultEnvelope();
	const version = typeof parsed.version === 'number' ? parsed.version : 1;
	if (version !== SECRETS_VERSION) {
		// Pre-release: no migrations. Treat unknown shapes (incl. old 'plaintext'
		// envelopes that fail the mode check below) as a fresh start.
		return defaultEnvelope();
	}
	const mode = parsed.mode;
	if (mode !== 'safeStorage' && mode !== 'passphrase') {
		return defaultEnvelope();
	}
	const keys = isObject(parsed.keys) ? parsed.keys as Record<string, string> : {};
	const envelope: SecretsEnvelope = { version, mode, keys };
	if (mode === 'passphrase') {
		const kdf = parseKdf(parsed.kdf);
		const verifier = typeof parsed.verifier === 'string' ? parsed.verifier : undefined;
		// Only a complete kdf+verifier pair counts as configured; otherwise the
		// envelope is treated as unconfigured (prompt to create a passphrase).
		if (kdf && verifier) {
			envelope.kdf = kdf;
			envelope.verifier = verifier;
		}
	}
	return envelope;
}

async function readEnvelopeFromDisk(plugin: Plugin): Promise<SecretsEnvelope> {
	const path = secretsPath(plugin);
	const exists = await plugin.app.vault.adapter.exists(path);
	if (!exists) return defaultEnvelope();
	try {
		const raw = await plugin.app.vault.adapter.read(path);
		return parseEnvelope(raw);
	} catch {
		return defaultEnvelope();
	}
}

async function ensureEnvelope(plugin: Plugin): Promise<SecretsEnvelope> {
	if (cachedEnvelope) return cachedEnvelope;
	cachedEnvelope = await readEnvelopeFromDisk(plugin);
	return cachedEnvelope;
}

async function writeEnvelope(plugin: Plugin, envelope: SecretsEnvelope): Promise<void> {
	const path = secretsPath(plugin);
	await plugin.app.vault.adapter.write(path, JSON.stringify(envelope));
	cachedEnvelope = envelope;
}

// ---------- base64 / buffer helpers ----------

function bytesToBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
	return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function base64ToNodeBuffer(b64: string): unknown {
	const Buf = (globalThis as unknown as { Buffer?: { from(s: string, enc: string): unknown } }).Buffer;
	if (Buf && typeof Buf.from === 'function') return Buf.from(b64, 'base64');
	return base64ToBytes(b64);
}

function randomBytes(n: number): Uint8Array {
	const out = new Uint8Array(n);
	crypto.getRandomValues(out);
	return out;
}

// Heuristic: did an Argon2 derivation fail because the device couldn't allocate the
// requested memory (or run wasm at all)? Used to fall back to PBKDF2 at creation and
// to give a clear message at unlock.
function isAllocationFailure(e: unknown): boolean {
	if (e instanceof RangeError) return true;
	const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
	return msg.includes('memory') || msg.includes('alloc') || msg.includes('wasm') || msg.includes('webassembly');
}

// ---------- key derivation ----------

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
	const passBytes = new TextEncoder().encode(passphrase);
	const baseKey = await crypto.subtle.importKey(
		'raw',
		passBytes,
		{ name: 'PBKDF2' },
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

async function deriveArgon2idKey(
	passphrase: string,
	salt: Uint8Array,
	memKiB: number,
	timeCost: number,
	parallelism: number,
): Promise<CryptoKey> {
	const raw = await argon2id({
		password: passphrase,
		salt,
		parallelism,
		iterations: timeCost,
		memorySize: memKiB,
		hashLength: ARGON2_HASH_BYTES,
		outputType: 'binary',
	});
	return crypto.subtle.importKey(
		'raw',
		raw as BufferSource,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt'],
	);
}

async function deriveKeyFromKdf(passphrase: string, kdf: PassphraseKdf): Promise<CryptoKey> {
	const salt = base64ToBytes(kdf.salt);
	if (kdf.algo === 'argon2id') {
		return deriveArgon2idKey(
			passphrase,
			salt,
			kdf.memKiB ?? ARGON2_MEM_KIB,
			kdf.timeCost ?? ARGON2_TIME,
			kdf.parallelism ?? ARGON2_PARALLELISM,
		);
	}
	return deriveKeyFromPassphrase(passphrase, salt, kdf.iterations ?? PBKDF2_ITERATIONS);
}

// Build a fresh kdf + derived key for a new passphrase. Prefers Argon2id; on any
// derivation failure (wasm unavailable / can't allocate memory) falls back to PBKDF2
// so a constrained device can still set a passphrase.
async function buildPassphraseKdfAndKey(passphrase: string): Promise<{ kdf: PassphraseKdf; key: CryptoKey }> {
	const salt = randomBytes(KDF_SALT_BYTES);
	try {
		const key = await deriveArgon2idKey(passphrase, salt, ARGON2_MEM_KIB, ARGON2_TIME, ARGON2_PARALLELISM);
		return {
			kdf: {
				algo: 'argon2id',
				salt: bytesToBase64(salt),
				memKiB: ARGON2_MEM_KIB,
				timeCost: ARGON2_TIME,
				parallelism: ARGON2_PARALLELISM,
			},
			key,
		};
	} catch {
		const key = await deriveKeyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS);
		return {
			kdf: { algo: 'pbkdf2', salt: bytesToBase64(salt), iterations: PBKDF2_ITERATIONS },
			key,
		};
	}
}

// ---------- AES-GCM value codec ----------

async function aesGcmEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
	const iv = randomBytes(AES_IV_BYTES);
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		new TextEncoder().encode(plaintext),
	);
	return `${bytesToBase64(iv)}${VALUE_SEP}${bytesToBase64(new Uint8Array(ct))}`;
}

async function aesGcmDecrypt(key: CryptoKey, payload: string): Promise<string> {
	const sepIdx = payload.indexOf(VALUE_SEP);
	if (sepIdx <= 0) throw new Error('Malformed encrypted value');
	const iv = base64ToBytes(payload.slice(0, sepIdx));
	const ct = base64ToBytes(payload.slice(sepIdx + 1));
	const pt = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		ct as BufferSource,
	);
	return new TextDecoder().decode(pt);
}

// ---------- per-mode encrypt/decrypt of a single value ----------

async function encryptValue(envelope: SecretsEnvelope, plaintext: string): Promise<string> {
	if (envelope.mode === 'safeStorage') {
		const ss = getSafeStorage();
		if (!ss) throw new Error('OS keychain encryption is not available on this device.');
		return ss.encryptString(plaintext).toString('base64');
	}
	// passphrase
	if (!unlockedKey) throw new Error('Secrets are locked. Unlock with your passphrase first.');
	return aesGcmEncrypt(unlockedKey, plaintext);
}

async function decryptValue(envelope: SecretsEnvelope, stored: string): Promise<string> {
	if (stored === '') return '';
	if (envelope.mode === 'safeStorage') {
		const ss = getSafeStorage();
		if (!ss) return '';
		try {
			return ss.decryptString(base64ToNodeBuffer(stored));
		} catch {
			return '';
		}
	}
	// passphrase
	if (!unlockedKey) return '';
	try {
		return await aesGcmDecrypt(unlockedKey, stored);
	} catch {
		return '';
	}
}

async function decryptAllToPlain(envelope: SecretsEnvelope): Promise<Record<string, string>> {
	const plain: Record<string, string> = {};
	for (const id of Object.keys(envelope.keys)) {
		const v = await decryptValue(envelope, envelope.keys[id] ?? '');
		if (v) plain[id] = v;
	}
	return plain;
}

// Write a freshly-built passphrase envelope (kdf + verifier) and re-encrypt `plain`
// under the new key. Sets unlockedKey. Used by mode change, change-passphrase, and
// the unlock-time KDF upgrade. Does NOT enforce entropy (the caller does, when needed).
async function writePassphraseEnvelope(
	plugin: Plugin,
	passphrase: string,
	plain: Record<string, string>,
): Promise<void> {
	const { kdf, key } = await buildPassphraseKdfAndKey(passphrase);
	unlockedKey = key;
	const next: SecretsEnvelope = { version: SECRETS_VERSION, mode: 'passphrase', kdf, keys: {} };
	next.verifier = await aesGcmEncrypt(key, VERIFIER_PLAINTEXT);
	cachedEnvelope = next;
	for (const id of Object.keys(plain)) {
		next.keys[id] = await encryptValue(next, plain[id] ?? '');
	}
	await writeEnvelope(plugin, next);
}

// Best-effort upgrade of a legacy PBKDF2 envelope to Argon2id on unlock. Requires the
// current (pbkdf2) key already in unlockedKey so we can read the stored values. If the
// device can't run Argon2id, leaves the envelope on PBKDF2.
async function tryUpgradeToArgon2id(plugin: Plugin, passphrase: string): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode !== 'passphrase' || envelope.kdf?.algo !== 'pbkdf2') return;
	const plain = await decryptAllToPlain(envelope);
	const built = await buildPassphraseKdfAndKey(passphrase);
	if (built.kdf.algo !== 'argon2id') return; // device can't do Argon2id; keep PBKDF2
	unlockedKey = built.key;
	const next: SecretsEnvelope = { version: SECRETS_VERSION, mode: 'passphrase', kdf: built.kdf, keys: {} };
	next.verifier = await aesGcmEncrypt(built.key, VERIFIER_PLAINTEXT);
	cachedEnvelope = next;
	for (const id of Object.keys(plain)) {
		next.keys[id] = await encryptValue(next, plain[id] ?? '');
	}
	await writeEnvelope(plugin, next);
}

// ---------- public API ----------

export async function getEncryptionStatus(plugin: Plugin): Promise<EncryptionStatus> {
	const envelope = await ensureEnvelope(plugin);
	const verified = getSafeStorage() !== null;
	const raw = getRawSafeStorage() !== null;
	return {
		mode: envelope.mode,
		locked: envelope.mode === 'passphrase' && unlockedKey === null,
		configured: envelope.mode !== 'passphrase' || (envelope.kdf != null && envelope.verifier != null),
		safeStorageAvailable: verified,
		safeStorageInsecure: raw && !verified,
		safeStorageBackend: getSafeStorageBackend(),
	};
}

export function isEncryptionAvailable(): boolean {
	return getSafeStorage() !== null;
}

export function lockSecrets(): void {
	unlockedKey = null;
}

export async function unlockSecrets(plugin: Plugin, passphrase: string): Promise<boolean> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode !== 'passphrase') return true;
	if (!envelope.kdf || !envelope.verifier) return false;
	let candidate: CryptoKey;
	try {
		candidate = await deriveKeyFromKdf(passphrase, envelope.kdf);
	} catch (e) {
		if (envelope.kdf.algo === 'argon2id' && isAllocationFailure(e)) {
			const mib = Math.round((envelope.kdf.memKiB ?? ARGON2_MEM_KIB) / 1024);
			throw new Error(
				`This device can't allocate the ~${mib} MiB needed to unlock. These secrets were encrypted with Argon2id on a device with more memory.`,
			);
		}
		return false;
	}
	try {
		const decoded = await aesGcmDecrypt(candidate, envelope.verifier);
		if (decoded !== VERIFIER_PLAINTEXT) return false;
	} catch {
		return false;
	}
	unlockedKey = candidate;
	// Opportunistically migrate legacy PBKDF2 envelopes to Argon2id while we hold the
	// passphrase. Best-effort: failures leave the envelope (and unlockedKey) on PBKDF2.
	if (envelope.kdf.algo === 'pbkdf2') {
		try {
			await tryUpgradeToArgon2id(plugin, passphrase);
		} catch {
			// keep PBKDF2; nothing to do
		}
	}
	return true;
}

export async function saveKey(plugin: Plugin, id: string, key: string): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'passphrase' && unlockedKey === null) {
		throw new Error('Secrets are locked. Unlock with your passphrase to save keys.');
	}
	if (key === '') {
		delete envelope.keys[id];
	} else {
		envelope.keys[id] = await encryptValue(envelope, key);
	}
	await writeEnvelope(plugin, envelope);
}

export async function saveManyKeys(plugin: Plugin, updates: Record<string, string>): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'passphrase' && unlockedKey === null) {
		// Caller (settings save) may run while locked or unconfigured. Don't blow up;
		// just skip writing so we don't clobber on-disk encrypted values with empties.
		return;
	}
	for (const id of Object.keys(updates)) {
		const value = updates[id] ?? '';
		if (value === '') {
			delete envelope.keys[id];
		} else {
			envelope.keys[id] = await encryptValue(envelope, value);
		}
	}
	await writeEnvelope(plugin, envelope);
}

export async function loadKey(plugin: Plugin, id: string): Promise<string> {
	const envelope = await ensureEnvelope(plugin);
	const stored = envelope.keys[id];
	if (typeof stored !== 'string' || stored === '') return '';
	return decryptValue(envelope, stored);
}

export async function deleteKey(plugin: Plugin, id: string): Promise<void> {
	await saveKey(plugin, id, '');
}

export async function loadAllKeys(plugin: Plugin): Promise<Record<string, string>> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === 'passphrase' && unlockedKey === null) return {};
	return decryptAllToPlain(envelope);
}

// ---------- mode transitions ----------

export async function changeEncryptionMode(
	plugin: Plugin,
	newMode: EncryptionMode,
	newPassphrase?: string,
): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode === newMode && newMode !== 'passphrase') return;
	if (envelope.mode === 'passphrase' && unlockedKey === null && envelope.kdf) {
		throw new Error('Unlock secrets with the current passphrase before changing modes.');
	}
	if (newMode === 'safeStorage' && !getSafeStorage()) {
		throw new Error('OS keychain encryption is not available on this device.');
	}
	if (newMode === 'passphrase') {
		if (!newPassphrase || newPassphrase.length === 0) {
			throw new Error('A passphrase is required to switch to passphrase mode.');
		}
		if (!(await isPassphraseAcceptable(newPassphrase))) {
			throw new Error('Passphrase is too weak. Use a longer, more unique passphrase (try the Generate button).');
		}
	}

	const plain = await decryptAllToPlain(envelope);

	if (newMode === 'passphrase') {
		await writePassphraseEnvelope(plugin, newPassphrase ?? '', plain);
		return;
	}

	// safeStorage
	unlockedKey = null;
	const next: SecretsEnvelope = { version: SECRETS_VERSION, mode: 'safeStorage', keys: {} };
	cachedEnvelope = next;
	for (const id of Object.keys(plain)) {
		next.keys[id] = await encryptValue(next, plain[id] ?? '');
	}
	await writeEnvelope(plugin, next);
}

// Forgot-passphrase recovery. Discards all existing key material (the old keys are
// unrecoverable without the old passphrase) and writes a fresh, empty passphrase envelope
// under a new passphrase. Unlike changePassphrase, this does NOT require unlocking first.
export async function resetSecrets(plugin: Plugin, newPassphrase: string): Promise<void> {
	if (newPassphrase.length === 0) {
		throw new Error('A passphrase is required.');
	}
	if (!(await isPassphraseAcceptable(newPassphrase))) {
		throw new Error('Passphrase is too weak. Use a longer, more unique passphrase (try the Generate button).');
	}
	// The old passphrase is forgotten, so the old keys are gone for good. Drop any cached
	// state and write a fresh, empty passphrase envelope under the new key.
	unlockedKey = null;
	cachedEnvelope = null;
	await writePassphraseEnvelope(plugin, newPassphrase, {});
}

export async function changePassphrase(plugin: Plugin, newPassphrase: string): Promise<void> {
	const envelope = await ensureEnvelope(plugin);
	if (envelope.mode !== 'passphrase') {
		throw new Error('Not in passphrase mode.');
	}
	if (unlockedKey === null && envelope.kdf) {
		throw new Error('Unlock with the current passphrase first.');
	}
	if (newPassphrase.length === 0) {
		throw new Error('Passphrase cannot be empty.');
	}
	await changeEncryptionMode(plugin, 'passphrase', newPassphrase);
}
