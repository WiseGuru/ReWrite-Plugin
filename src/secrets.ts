import { normalizePath, Platform, Plugin } from 'obsidian';

const SECRETS_FILE = 'secrets.json.nosync';
const ENCRYPTED_SUFFIX = '_encrypted';

type SecretsFile = Record<string, string | boolean>;

interface SafeStorageAPI {
	isEncryptionAvailable(): boolean;
	encryptString(plain: string): { toString(encoding: string): string };
	decryptString(buf: unknown): string;
}

let safeStorageCache: SafeStorageAPI | null | undefined;

function getSafeStorage(): SafeStorageAPI | null {
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

function secretsPath(plugin: Plugin): string {
	const dir = plugin.manifest.dir;
	if (!dir) throw new Error('Plugin manifest.dir is missing');
	return normalizePath(`${dir}/${SECRETS_FILE}`);
}

async function readSecretsFile(plugin: Plugin): Promise<SecretsFile> {
	const path = secretsPath(plugin);
	const exists = await plugin.app.vault.adapter.exists(path);
	if (!exists) return {};
	try {
		const raw = await plugin.app.vault.adapter.read(path);
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === 'object') return parsed as SecretsFile;
		return {};
	} catch {
		return {};
	}
}

async function writeSecretsFile(plugin: Plugin, secrets: SecretsFile): Promise<void> {
	const path = secretsPath(plugin);
	await plugin.app.vault.adapter.write(path, JSON.stringify(secrets));
}

function base64ToNodeBuffer(b64: string): unknown {
	const Buf = (globalThis as unknown as { Buffer?: { from(s: string, enc: string): unknown } }).Buffer;
	if (Buf && typeof Buf.from === 'function') return Buf.from(b64, 'base64');
	// safeStorage exists only when Electron is present, which always provides Buffer.
	// This fallback is defensive: decode to Uint8Array so the call doesn't crash if the host is unusual.
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function applyKeyToSecrets(secrets: SecretsFile, id: string, key: string): void {
	if (key === '') {
		delete secrets[id];
		delete secrets[id + ENCRYPTED_SUFFIX];
		return;
	}
	const ss = getSafeStorage();
	if (ss) {
		const encrypted = ss.encryptString(key);
		secrets[id] = encrypted.toString('base64');
		secrets[id + ENCRYPTED_SUFFIX] = true;
	} else {
		secrets[id] = key;
		secrets[id + ENCRYPTED_SUFFIX] = false;
	}
}

export async function saveKey(plugin: Plugin, id: string, key: string): Promise<void> {
	const secrets = await readSecretsFile(plugin);
	applyKeyToSecrets(secrets, id, key);
	await writeSecretsFile(plugin, secrets);
}

export async function saveManyKeys(
	plugin: Plugin,
	updates: Record<string, string>,
): Promise<void> {
	const secrets = await readSecretsFile(plugin);
	for (const id of Object.keys(updates)) {
		const value = updates[id] ?? '';
		applyKeyToSecrets(secrets, id, value);
	}
	await writeSecretsFile(plugin, secrets);
}

export async function loadKey(plugin: Plugin, id: string): Promise<string> {
	const secrets = await readSecretsFile(plugin);
	const value = secrets[id];
	if (typeof value !== 'string' || value === '') return '';
	const encrypted = secrets[id + ENCRYPTED_SUFFIX] === true;
	if (!encrypted) return value;
	const ss = getSafeStorage();
	if (!ss) return '';
	try {
		return ss.decryptString(base64ToNodeBuffer(value));
	} catch {
		return '';
	}
}

export async function deleteKey(plugin: Plugin, id: string): Promise<void> {
	await saveKey(plugin, id, '');
}

export async function loadAllKeys(plugin: Plugin): Promise<Record<string, string>> {
	const secrets = await readSecretsFile(plugin);
	const out: Record<string, string> = {};
	for (const id of Object.keys(secrets)) {
		if (id.endsWith(ENCRYPTED_SUFFIX)) continue;
		const value = await loadKey(plugin, id);
		if (value) out[id] = value;
	}
	return out;
}

export function isEncryptionAvailable(): boolean {
	return getSafeStorage() !== null;
}
