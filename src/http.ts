import { requestUrl, RequestUrlResponse } from 'obsidian';

export class ProviderError extends Error {
	constructor(
		public readonly provider: string,
		public readonly status: number,
		public readonly body: string,
		message?: string,
	) {
		super(message ?? `${provider} error ${status}: ${body.slice(0, 200)}`);
		this.name = 'ProviderError';
	}
}

export interface MultipartTextPart {
	type: 'text';
	name: string;
	value: string;
}

export interface MultipartFilePart {
	type: 'file';
	name: string;
	filename: string;
	contentType: string;
	data: ArrayBuffer;
}

export type MultipartPart = MultipartTextPart | MultipartFilePart;

export interface ProviderRequestInit {
	provider: string;
	url: string;
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	signal?: AbortSignal;
}

function abortIfSignaled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new DOMException('Aborted', 'AbortError');
	}
}

// Replaces any `?...` query portion in a string with `?<redacted>` so a request
// URL surfacing inside an error message cannot leak query-string secrets (e.g. a
// provider that authenticates via `?key=`). Stops at whitespace so only the URL's
// query is masked, not the rest of the message.
function redactQueryStrings(text: string): string {
	return text.replace(/\?\S*/g, '?<redacted>');
}

export async function providerRequest(
	init: ProviderRequestInit,
): Promise<RequestUrlResponse> {
	abortIfSignaled(init.signal);
	let res: RequestUrlResponse;
	try {
		res = await requestUrl({
			url: init.url,
			method: init.method ?? 'POST',
			headers: init.headers,
			body: init.body,
			throw: false,
		});
	} catch (e) {
		const raw = e instanceof Error ? e.message : String(e);
		// requestUrl's network-failure message can echo the full request URL, which
		// for query-authenticated providers would carry the API key. Strip query
		// strings defensively before the message reaches a Notice or the log.
		const msg = redactQueryStrings(raw);
		throw new ProviderError(init.provider, 0, msg, `${init.provider} request failed: ${msg}`);
	}
	abortIfSignaled(init.signal);
	if (res.status < 200 || res.status >= 300) {
		throw new ProviderError(init.provider, res.status, res.text);
	}
	return res;
}

export async function jsonPost<T = unknown>(
	provider: string,
	url: string,
	body: unknown,
	headers: Record<string, string> = {},
	signal?: AbortSignal,
): Promise<T> {
	const res = await providerRequest({
		provider,
		url,
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
		signal,
	});
	return res.json as T;
}

export async function jsonGet<T = unknown>(
	provider: string,
	url: string,
	headers: Record<string, string> = {},
	signal?: AbortSignal,
): Promise<T> {
	const res = await providerRequest({
		provider,
		url,
		method: 'GET',
		headers,
		signal,
	});
	return res.json as T;
}

export async function multipartPost(
	provider: string,
	url: string,
	parts: MultipartPart[],
	headers: Record<string, string> = {},
	signal?: AbortSignal,
): Promise<RequestUrlResponse> {
	const { body, contentType } = buildMultipart(parts);
	return providerRequest({
		provider,
		url,
		method: 'POST',
		headers: { 'Content-Type': contentType, ...headers },
		body,
		signal,
	});
}

export function buildMultipart(parts: MultipartPart[]): {
	body: ArrayBuffer;
	contentType: string;
} {
	const boundary = `----RewriteBoundary${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];

	for (const part of parts) {
		if (part.type === 'text') {
			const header =
				`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="${escapeMultipartName(part.name)}"\r\n` +
				`\r\n`;
			chunks.push(encoder.encode(header));
			chunks.push(encoder.encode(part.value));
			chunks.push(encoder.encode('\r\n'));
		} else {
			const header =
				`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="${escapeMultipartName(part.name)}"; filename="${escapeMultipartName(part.filename)}"\r\n` +
				`Content-Type: ${part.contentType}\r\n` +
				`\r\n`;
			chunks.push(encoder.encode(header));
			chunks.push(new Uint8Array(part.data));
			chunks.push(encoder.encode('\r\n'));
		}
	}
	chunks.push(encoder.encode(`--${boundary}--\r\n`));

	const total = chunks.reduce((n, c) => n + c.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { body: out.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

function escapeMultipartName(name: string): string {
	return name.replace(/"/g, '%22').replace(/\r|\n/g, '');
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	abortIfSignaled(signal);
	await new Promise<void>((resolve, reject) => {
		const timer = window.setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			window.clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
