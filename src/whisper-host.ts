import { Platform } from 'obsidian';
import { LocalWhisperSettings } from './types';

export type WhisperStatus = 'stopped' | 'starting' | 'running' | 'crashed';

interface SpawnedChild {
	stdout: { on(event: 'data', cb: (chunk: { toString(): string }) => void): void } | null;
	stderr: { on(event: 'data', cb: (chunk: { toString(): string }) => void): void } | null;
	on(event: 'exit', cb: (code: number | null, signal: string | null) => void): void;
	once(event: 'exit', cb: (code: number | null, signal: string | null) => void): void;
	kill(signal?: string): boolean;
}

interface ChildProcessAPI {
	spawn(
		command: string,
		args: string[],
		options: { stdio: Array<'ignore' | 'pipe'> },
	): SpawnedChild;
}

interface NetSocket {
	on(event: 'error' | 'connect', cb: () => void): void;
	once(event: 'error' | 'connect', cb: () => void): void;
	end(): void;
	destroy(): void;
}

interface NetServer {
	once(event: 'error' | 'listening', cb: (err?: Error) => void): void;
	close(cb?: () => void): void;
	listen(port: number, host: string): void;
}

interface NetAPI {
	createServer(): NetServer;
	createConnection(opts: { host: string; port: number }): NetSocket;
}

interface FsAPI {
	existsSync(path: string): boolean;
}

interface NodeAPI {
	cp: ChildProcessAPI;
	net: NetAPI;
	fs: FsAPI;
}

let nodeApiCache: NodeAPI | null | undefined;

function getNodeApi(): NodeAPI | null {
	if (nodeApiCache !== undefined) return nodeApiCache;
	if (!Platform.isDesktop) {
		nodeApiCache = null;
		return null;
	}
	try {
		const req =
			(window as unknown as { require?: (m: string) => unknown }).require ??
			(globalThis as unknown as { require?: (m: string) => unknown }).require;
		if (typeof req !== 'function') {
			nodeApiCache = null;
			return null;
		}
		const cp = req('child_process') as ChildProcessAPI;
		const net = req('net') as NetAPI;
		const fs = req('fs') as FsAPI;
		nodeApiCache = { cp, net, fs };
		return nodeApiCache;
	} catch {
		nodeApiCache = null;
		return null;
	}
}

export function isWhisperHostAvailable(): boolean {
	return getNodeApi() !== null;
}

const MAX_LOG_BYTES = 1_000_000;
const READY_TIMEOUT_MS = 5_000;
const READY_POLL_MS = 250;
const STOP_KILL_GRACE_MS = 3_000;

export class WhisperHost {
	private statusValue: WhisperStatus = 'stopped';
	private child: SpawnedChild | null = null;
	private currentPort: number | null = null;
	private logBuffer = '';
	private stoppingDeliberately = false;

	status(): WhisperStatus {
		return this.statusValue;
	}

	baseUrl(): string | null {
		if (this.statusValue !== 'running' || this.currentPort === null) return null;
		return `http://127.0.0.1:${this.currentPort}`;
	}

	getLog(): string {
		return this.logBuffer;
	}

	async start(config: LocalWhisperSettings): Promise<void> {
		if (this.statusValue === 'running' || this.statusValue === 'starting') {
			return;
		}
		const api = getNodeApi();
		if (!api) {
			throw new Error('Local whisper.cpp server requires desktop Obsidian.');
		}
		if (!config.binaryPath) throw new Error('Binary path is not configured.');
		if (!config.modelPath) throw new Error('Model path is not configured.');
		if (!api.fs.existsSync(config.binaryPath)) {
			throw new Error(`Binary not found: ${config.binaryPath}`);
		}
		if (!api.fs.existsSync(config.modelPath)) {
			throw new Error(`Model not found: ${config.modelPath}`);
		}
		const port = Number.isFinite(config.port) && config.port > 0 ? config.port : 8080;
		if (await isPortInUse(api.net, port)) {
			throw new Error(`Port ${port} is already in use. Another whisper-server may be bound to it; check Activity Monitor or Task Manager.`);
		}

		this.statusValue = 'starting';
		this.logBuffer = '';
		this.stoppingDeliberately = false;

		const args = [
			'-m', config.modelPath,
			'--port', String(port),
			...splitArgs(config.extraArgs),
		];
		const child = api.cp.spawn(config.binaryPath, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		this.child = child;
		this.currentPort = port;

		const append = (s: string): void => {
			this.logBuffer += s;
			if (this.logBuffer.length > MAX_LOG_BYTES) {
				this.logBuffer = this.logBuffer.slice(-MAX_LOG_BYTES);
			}
		};
		child.stdout?.on('data', (d) => append(d.toString()));
		child.stderr?.on('data', (d) => append(d.toString()));
		child.on('exit', (code, signal) => {
			append(`\n[process exited code=${code ?? 'null'} signal=${signal ?? 'null'}]\n`);
			if (this.child === child) {
				this.child = null;
				if (!this.stoppingDeliberately) {
					this.statusValue = 'crashed';
				}
			}
		});

		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (!this.child) {
				const tail = this.logBuffer.slice(-500);
				this.statusValue = 'crashed';
				throw new Error(`whisper-server exited during startup. Log tail: ${tail || '(empty)'}`);
			}
			if (await isPortReachable(api.net, port)) {
				this.statusValue = 'running';
				return;
			}
			await delay(READY_POLL_MS);
		}

		this.stoppingDeliberately = true;
		try { child.kill(); } catch { /* best effort */ }
		this.child = null;
		this.currentPort = null;
		this.statusValue = 'crashed';
		const tail = this.logBuffer.slice(-500);
		throw new Error(`whisper-server did not become ready within ${READY_TIMEOUT_MS / 1000}s. Log tail: ${tail || '(empty)'}`);
	}

	async stop(): Promise<void> {
		const child = this.child;
		if (!child) {
			this.statusValue = 'stopped';
			this.currentPort = null;
			return;
		}
		this.stoppingDeliberately = true;
		this.statusValue = 'stopped';
		this.child = null;
		this.currentPort = null;

		await new Promise<void>((resolve) => {
			let settled = false;
			const finish = (): void => {
				if (settled) return;
				settled = true;
				resolve();
			};
			child.once('exit', finish);
			try { child.kill(); } catch { /* best effort */ }
			setTimeout(() => {
				try { child.kill('SIGKILL'); } catch { /* best effort */ }
				finish();
			}, STOP_KILL_GRACE_MS);
		});
	}
}

function splitArgs(s: string): string[] {
	const trimmed = s.trim();
	if (!trimmed) return [];
	return trimmed.split(/\s+/);
}

function isPortInUse(net: NetAPI, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		let settled = false;
		const done = (inUse: boolean): void => {
			if (settled) return;
			settled = true;
			resolve(inUse);
		};
		server.once('error', () => done(true));
		server.once('listening', () => {
			server.close(() => done(false));
		});
		try {
			server.listen(port, '127.0.0.1');
		} catch {
			done(true);
		}
	});
}

function isPortReachable(net: NetAPI, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (reachable: boolean, socket?: NetSocket): void => {
			if (settled) return;
			settled = true;
			try { socket?.destroy(); } catch { /* best effort */ }
			resolve(reachable);
		};
		try {
			const socket = net.createConnection({ host: '127.0.0.1', port });
			socket.once('connect', () => done(true, socket));
			socket.once('error', () => done(false, socket));
		} catch {
			done(false);
		}
	});
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
