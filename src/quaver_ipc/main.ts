import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

import Observer from '@lib/observer';

import { dropNull, unpack } from '@quaver-ipc/pack';

export type IpcDocument = {
	readonly session?: string,
	readonly plugin?: IpcNode,
	companion?: IpcNode,
}

export type IpcMessage = {
	readonly id: string;
	readonly session: string;
	readonly type?: string;
	readonly [key: string]: unknown;
}

export type IpcNode = {
	readonly msgs?: (IpcMessage | null)[] | null;
	readonly acks?: (string | number | null)[] | null;
	readonly ro?: Record<string, unknown>;
	readonly rev?: number | string;
}

const BOOT_ID = Math.random().toString(36).slice(2, 8);
const TICK_MS = 50;
const PING_MS = 500;
const PING_TIMEOUT = 5000;
const FORMAT = 'json';

/**
 * IPC class for communicating with the Quaver plugin.
 * Uses a file-based protocol where the plugin and companion read/write a shared config file.
 */
class IPC {

	public listeners = {
		message: new Observer<IpcMessage>(),
		tick: new Observer(),
		timeout: new Observer(),
		attach: new Observer(),
		detach: new Observer(),

		configRead: new Observer(),
		configReadError: new Observer<unknown>(),
		configWrite: new Observer(),
		configConflict: new Observer(),
	} as const;

	protected session?: string;

	protected ticker?: ReturnType<typeof setInterval>;

	protected configPath = path.join(process.cwd(), 'config.yaml');

	protected out: IpcMessage[] = [];

	protected seq = 0;

	/** Revision of our node, bumped on every change; we only write when the file's copy differs */
	protected rev = Date.now();

	protected lastPingValue = 0;
	protected lastMatchedPong = 0;
	protected lastPongTime = 0;

	/** Read-only fields exposed by/to the plugin */
	protected exposed = new Map<string, unknown>();
	protected read = new Map<string, unknown>();

	/** Message senders awaiting for acknowledgement */
	protected awaitingAcks = new Map<string, (received: boolean) => void>();

	/** Received message IDs to acknowledge */
	protected toAck = new Set<string>();

	/** Received message IDs this tick */
	protected toAckTick = new Set<string>();

	private static _instance?: IPC;
	constructor() {
		if (IPC._instance) return IPC._instance;
		IPC._instance = this;

		this.ticker = setInterval(() => this.onTick(), TICK_MS);

		const ping = () => {
			if (!this.ticker) return;
			this.ping();
			setTimeout(ping, PING_MS);
		};
		ping();

		return this;
	}

	protected checkSession() {
		const document = this.getConfig(true);
		if (this.session && document.session !== this.session) {
			this.detach();
		}
		if (document.session && this.session !== document.session) {
			this.attach(document.session);
		}
	}

	protected attach(session: string) {
		this.session = session;
		this.clear();
		this.ping();
		this.listeners.attach.trigger();
	}

	protected detach() {
		delete this.session;
		this.clear();
		this.listeners.detach.trigger();
	}

	protected clear(): void {
		this.out.length = 0;
		this.seq = 0;
		this.exposed.clear();
		this.read.clear();
		this.lastPingValue = 0;
		this.lastMatchedPong = Date.now() - 1;
		this.lastPongTime = 0;
		this.toAck.clear();
		this.toAckTick.clear();
		this.awaitingAcks.forEach((resolve) => resolve(false));
		this.awaitingAcks.clear();
		this.rev = Date.now();
	}

	protected touch(): void {
		this.rev++;
	}

	getConfigPath(): string {
		return this.configPath;
	}

	stop(): void {
		clearInterval(this.ticker);
		delete this.ticker;
	}

	setConfigPath(configPath: string): void {
		if (configPath === this.configPath) return;
		this.configPath = configPath;
		this._lastDocument = {};
		this._lastConfig = '';
	}

	get(key: string): unknown {
		return this.read.get(key);
	}

	set(key: string, value: unknown): void {
		const current = this.exposed.get(key);
		if (current === value || JSON.stringify(current) === JSON.stringify(value)) return;
		this.exposed.set(key, value);
		this.touch();
	}

	async send(payload: Omit<IpcMessage, 'id' | 'session'>) {
		if (!this.session) return Promise.resolve(false);
		const msg: IpcMessage = {
			id: `c${BOOT_ID}-${++this.seq}`,
			session: this.session,
			...(this.read.get('format') === FORMAT ? { data: JSON.stringify(payload, dropNull) } : payload),
		};
		this.out.push(msg);
		this.touch();

		return new Promise<boolean>((resolve) => {
			this.awaitingAcks.set(msg.id, resolve);
		});
	}

	isAlive(): boolean {
		return !!this.session
			&& this.lastPongTime > 0
			&& (Date.now() - this.lastPongTime) < PING_TIMEOUT;
	}

	protected onMessage(message: IpcMessage): void {
		if (String(message.session) !== String(this.session)) return;
		const id = String(message.id);
		if (this.toAck.has(id)) {
			this.toAckTick.add(id);
			return;
		}
		if (this.toAckTick.has(id)) return;
		this.toAck.add(id);
		this.toAckTick.add(id);
		this.touch();
		this.listeners.message.trigger(unpack(message));
	}

	protected ping(): void {
		this.lastPingValue = Date.now();
		this.exposed.set('ping', this.lastPingValue);
		this.touch();

		if (!this.isAlive()) {
			this.listeners.timeout.trigger();
		}
	}

	protected pong(): void {
		const pong = Number(this.read.get('pong'));
		if (isNaN(pong) || pong <= this.lastMatchedPong) return;

		this.lastMatchedPong = pong;
		this.lastPongTime    = Date.now();
	}

	timeSinceLastPong(): number {
		return Date.now() - this.lastPongTime;
	}

	protected onTick(): void {
		this.checkSession();
		if (!this.session) return;
		this.flush();
		const document = this.getConfig(true);

		const ackedIds = new Set<string>();
		document.plugin?.acks?.forEach((id) => {
			if (id === null) return;
			const idStr = id.toString();
			ackedIds.add(idStr);
			this.awaitingAcks.get(idStr)?.(true);
			this.awaitingAcks.delete(idStr);
		});
		if (ackedIds.size > 0) {
			const pending = this.out.length;
			this.out = this.out.filter((m) => !ackedIds.has(m.id));
			if (this.out.length !== pending) this.touch();
		}

		const toUnset = new Set(this.read.keys());
		if (document.plugin?.ro) {
			Object.entries(document.plugin.ro).forEach(([k, v]) => {
				this.read.set(k, v);
				toUnset.delete(k);
			});
		}
		toUnset.forEach((k) => this.read.delete(k));

		document.plugin?.msgs?.forEach((m) => m && this.onMessage(m));

		// Remove acks that were deleted from the messages
		Array.from(this.toAck.values()).forEach(id => {
			if (!this.toAckTick.has(id)) {
				this.toAck.delete(id);
				this.touch();
			}
		});
		this.toAckTick.clear();

		this.pong();
		this.listeners.tick.trigger();
	}

	protected flush(): void {
		if (!this.session) return;

		try {
			const document = this.getConfig(true);
			if (Number(document.companion?.rev) === this.rev) return;

			const node: { msgs?: IpcMessage[]; acks?: string[]; ro: Record<string, unknown>; rev: number } = {
				ro: {
					...Object.fromEntries(this.exposed.entries()),
					format: FORMAT, 
				},
				rev: this.rev,
			};
			if (this.out.length > 0) node.msgs = this.out;
			const acked = Array.from(this.toAck.values());
			if (acked.length > 0) node.acks = acked;
			document.companion = node;

			const newConfig = yaml.dump(document);

			if (this.getConfig(true) && this._configChanged) {
				this.listeners.configConflict.trigger();
				return;
			}
			fs.writeFileSync(this.configPath, newConfig, 'utf8');
			this.listeners.configWrite.trigger();
		} catch {
			return;
		}
	}

	private _lastConfig = '';
	private _configChanged = false;
	private _lastDocument: IpcDocument = {};
	protected getConfig(force = false): IpcDocument {
		if (!force && this._lastDocument) return this._lastDocument;
		try {
			const config = fs.readFileSync(this.configPath, 'utf8');
			if (config === this._lastConfig) {
				this._configChanged = false;
				return this._lastDocument;
			}
			const document = yaml.load(config);
			if (!this.isIpcDocument(document)) return this._lastDocument;
			this._lastDocument = document;
			this._configChanged = this._lastConfig !== config;
			this._lastConfig = config;
			this.listeners.configRead.trigger();
		} catch (e) {
			if (!(!!e && typeof e === 'object' && 'code' in e && (e.code === 'EBUSY' || e.code === 'ENOENT'))) {
				this.listeners.configReadError.trigger(e);
			}
		}
		return this._lastDocument;
	}

	protected isIpcDocument(doc: unknown): doc is IpcDocument {
		if (!doc || typeof doc !== 'object') return false;
		if (!('session' in doc) || typeof doc.session !== 'string') return false;
		if (!('plugin' in doc) || !this.isIpcNode(doc.plugin)) return false;
		if (('companion' in doc) && !this.isIpcNode(doc.companion)) return false;
		return true;
	}

	protected isIpcNode(node: unknown): node is IpcNode {
		if (!node || typeof node !== 'object') return false;
		if ('msgs' in node) {
			if (!Array.isArray(node.msgs)) return false;
			if (!node.msgs.every((m) => this.isIpcMessage(m) || m === null)) return false;
		}
		if ('acks' in node && node.acks !== null && !Array.isArray(node.acks)) return false;
		if ('ro' in node && (node.ro === null || typeof node.ro !== 'object')) return false;
		return true;
	}

	protected isIpcMessage(msg: unknown): msg is IpcMessage {
		if (!msg || typeof msg !== 'object') return false;
		if (!('id' in msg) || typeof msg.id !== 'string') return false;
		if (!('session' in msg) || typeof msg.session !== 'string') return false;
		if ('type' in msg && typeof msg.type !== 'string') return false;
		return true;
	}
};

export default new IPC();