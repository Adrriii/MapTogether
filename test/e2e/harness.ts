import { type ChildProcess, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { Lua } from '../lua';

const ROOT = path.join(import.meta.dir, '..', '..');
const DRAW_MS = 16;
const PLUGIN_BUNDLE = path.join(os.tmpdir(), `mtg-e2e-plugin-${process.pid}.lua`);

export const buildPlugin = (): void => {
	spawnSync('bun', ['scripts/build.ts', PLUGIN_BUNDLE], {
		cwd: ROOT,
		stdio: 'ignore',
	});
	if (!fs.existsSync(path.join(ROOT, 'plugin.lua'))) fs.copyFileSync(PLUGIN_BUNDLE, path.join(ROOT, 'plugin.lua'));
};

type Server = { url: string; port: number; log: string[]; close: () => Promise<void> };

export const startServer = async (port?: number, env: Record<string, string> = {}): Promise<Server> => {
	const chosen = port ?? await freePort();
	const log: string[] = [];
	const child = spawn('bun', [path.join(ROOT, 'src', 'server', 'main.ts')], {
		env: {
			...process.env,
			PORT: String(chosen),
			...env,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.stdout.on('data', (chunk: Buffer) => log.push(chunk.toString()));
	child.stderr.on('data', (chunk: Buffer) => log.push(chunk.toString()));
	const url = `ws://127.0.0.1:${chosen}`;
	await waitFor('server listening', () => log.join('').includes('Listening'), 15000);
	return {
		url,
		port: chosen,
		log,
		close: async () => {
			child.kill();
			await new Promise((resolve) => child.once('exit', resolve));
		},
	};
};

const freePort = async (): Promise<number> => {
	const probe = Bun.serve({
		port: 0,
		fetch: () => new Response(),
	});
	const port = probe.port ?? 0;
	await probe.stop(true);
	return port;
};

export const waitFor = async (label: string, check: () => boolean, ms = 15000): Promise<void> => {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (check()) return;
		await Bun.sleep(25);
	}
	if (!check()) throw new Error(`timed out waiting for: ${label}`);
};

export class Instance {
	readonly lua = new Lua();
	readonly log: string[] = [];
	readonly drawErrors: string[] = [];
	readonly quaverDir: string;
	readonly pluginDir: string;
	readonly songsDir: string;
	companion?: ChildProcess;
	private drawing = true;
	failReads = 0;
	writes = 0;
	private timer?: ReturnType<typeof setInterval>;

	constructor(readonly name: string, readonly serverUrl: string) {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), `mtg-e2e-${name}-`));
		this.quaverDir = path.join(base, 'Quaver');
		this.pluginDir = path.join(this.quaverDir, 'Plugins', 'MapTogether');
		this.songsDir = path.join(this.quaverDir, 'Songs');
		fs.mkdirSync(this.pluginDir, { recursive: true });
		fs.mkdirSync(path.join(this.songsDir, '100 - Test Song'), { recursive: true });
		fs.mkdirSync(path.join(base, 'tmp'), { recursive: true });
		fs.writeFileSync(path.join(this.quaverDir, 'quaver.cfg'), `[Config]\nUsername = ${name}\n`);
		fs.writeFileSync(path.join(this.pluginDir, 'settings.ini'), '[Settings]\nName = MapTogether\nAuthor = test\n');
		fs.copyFileSync(PLUGIN_BUNDLE, path.join(this.pluginDir, 'plugin.lua'));

		this.lua.register('__now', () => Date.now());
		this.lua.bindConfig(path.join(this.pluginDir, 'config.yaml'), {
			failRead: () => this.failReads > 0 && this.failReads-- > 0,
			onWrite: () => this.writes++,
		});
		this.check(this.lua.run(fs.readFileSync(path.join(import.meta.dir, 'editor.lua'), 'utf8'), 'editor'));
		const plugin = fs.readFileSync(PLUGIN_BUNDLE, 'utf8');
		this.check(this.lua.run(`${plugin}\n_G.__Sync = Sync\n_G.__Perform = Perform\n_G.__IPC = IPC\n_G.__Companion = Companion\n_G.__CFG = CFG`, 'plugin'));

		this.timer = setInterval(() => {
			if (!this.drawing) return;
			this.lua.run('editor.texts = {}');
			const error = this.lua.run('draw()');
			if (error && this.drawErrors.length < 20) this.drawErrors.push(error);
		}, DRAW_MS);
	}

	startCompanion(env: Record<string, string> = {}): void {
		const tmp = path.join(path.dirname(this.quaverDir), 'tmp');
		this.companion = spawn('bun', [path.join(ROOT, 'src', 'companion', 'main.ts')], {
			cwd: this.pluginDir,
			env: {
				...process.env,
				MT_SERVER: this.serverUrl,
				MT_SONGS_DIR: this.songsDir,
				MT_NO_UPDATE: '1',
				MT_NO_GUI: '1',
				TEMP: tmp,
				TMP: tmp,
				TMPDIR: tmp,
				...env,
			},
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const capture = (chunk: Buffer) => this.log.push(...chunk.toString().split('\n').filter((l) => l.trim()));
		this.companion.stdout?.on('data', capture);
		this.companion.stderr?.on('data', capture);
	}

	setWindowOpen(open: boolean): void {
		this.drawing = open;
		this.run(`editor.active = ${open}`);
	}

	stopCompanion(): void {
		this.companion?.kill();
		delete this.companion;
	}

	stop(): void {
		clearInterval(this.timer);
		this.stopCompanion();
	}

	check(error: string | undefined): void {
		if (error) throw new Error(`[${this.name}] ${error}`);
	}

	run(code: string): void {
		this.check(this.lua.run(code));
	}

	get<T = unknown>(expression: string): T {
		return this.lua.get(expression) as T;
	}

	click(label: string): void {
		this.run(`editor.click(${JSON.stringify(label)})`);
	}

	save(): void {
		const qua = this.get<string>('editor.qua()');
		fs.writeFileSync(path.join(this.songsDir, '100 - Test Song', 'map.qua'), qua);
	}

	dump(): string {
		return this.get<string>('editor.dump()');
	}

	texts(): string[] {
		const texts = this.get<string[] | Record<string, never>>('editor.texts');
		return Array.isArray(texts) ? texts : [];
	}

	errors(): string[] {
		const errors = this.get<string[] | Record<string, never>>('editor.errors');
		return [...(Array.isArray(errors) ? errors : []), ...this.drawErrors];
	}

	alive(): boolean {
		return this.get<boolean>('__IPC.isAlive()') === true;
	}

	guiUrl(): string | undefined {
		for (const line of this.log) {
			const match = line.match(/Companion window: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/);
			if (match) return match[1];
		}
		return;
	}

	syncState(): string {
		return this.get<string>('__Sync.state()');
	}

	peers(): number {
		return this.get<number>('#Network.getCollaborators()');
	}

	sessions(): number {
		return this.get<number>('#Network.sessionList()');
	}

	pendingJoiners(): { clientId: string; descriptor?: unknown }[] {
		const joiners = this.get<unknown[] | Record<string, never>>('__Sync.pendingJoiners()');
		return Array.isArray(joiners) ? joiners as { clientId: string; descriptor?: unknown }[] : [];
	}
}

export const toLua = (value: unknown): string => {
	if (Array.isArray(value)) return `{ ${value.map(toLua).join(', ')} }`;
	return JSON.stringify(value);
};

export const notes = (count: number, from = 1000, step = 125): number[][] =>
	Array.from({ length: count }, (_, i) => [from + i * step, (i % 4) + 1]);

export const launch = async (serverUrl: string, players: Record<string, number[][]>): Promise<Instance[]> => {
	const instances = Object.entries(players).map(([name, map]) => {
		const instance = new Instance(name, serverUrl);
		instance.run(`editor.load(${toLua(map)})`);
		instance.startCompanion();
		return instance;
	});
	await waitFor('companions linked', () => instances.every((i) => i.alive()), 30000);
	return instances;
};

export const host = async (instance: Instance): Promise<void> => {
	instance.click('Host this map');
	await waitFor('host marker placed', () => instance.dump().includes('__MAP_FINDER__'));
	instance.save();
	await waitFor('host synced', () => instance.syncState() === 'SYNCED');
};

export const join = async (hostInstance: Instance, joiner: Instance, adopt = false): Promise<void> => {
	await waitFor('session listed', () => joiner.sessions() >= 1);
	joiner.click('Join##');
	await waitFor('joiner marker placed', () => joiner.dump().includes('__MAP_FINDER__'));
	await waitFor('host sees joiner', () => hostInstance.pendingJoiners().some((j) => j.clientId));
	joiner.save();
	await waitFor('joiner map identified', () => hostInstance.pendingJoiners().some((j) => j.descriptor));
	hostInstance.click('Accept##');
	if (adopt) {
		await waitFor('joiner asked to adopt', () => joiner.syncState() === 'RECONCILING');
		joiner.click("Adopt host's map");
	}
	await waitFor('joiner synced', () => joiner.syncState() === 'SYNCED', 30000);
};

export const converged = (instances: Instance[]): boolean => {
	const [first, ...rest] = instances.map((i) => i.dump());
	return rest.every((d) => d === first);
};
