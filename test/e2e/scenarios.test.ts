import { afterEach, beforeAll, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';

import { buildPlugin, converged, host, Instance, join, launch, notes, startServer, waitFor } from './harness';

let cleanup: (() => void)[] = [];

beforeAll(() => buildPlugin());

afterEach(() => {
	cleanup.forEach((fn) => fn());
	cleanup = [];
});

const setup = async (players: Record<string, number[][]>) => {
	const server = await startServer();
	const instances = await launch(server.url, players);
	cleanup.push(() => {
		if (process.env['E2E_LOGS']) console.log('--- server', server.log.join('').replace(/\n/g, '|'));
		if (process.env['E2E_LOGS']) instances.forEach((i) => console.log(`--- ${i.name}`, i.log.filter((l) => !l.includes('[You:') && !l.includes('CURSOR')).slice(-40).join('|')));
		instances.forEach((i) => i.stop());
		void server.close();
	});
	return {
		server,
		instances,
	};
};

const noErrors = (instances: Instance[]): void => {
	for (const instance of instances) expect({ name: instance.name, errors: instance.errors() }).toEqual({ name: instance.name, errors: [] });
};

test('a joiner with a different map adopts the host map', async () => {
	const { instances: [a, b] } = await setup({ a: notes(120), b: notes(40, 3000, 333) });
	await host(a!);
	await join(a!, b!, true);
	await waitFor('maps converge', () => converged([a!, b!]));
	b!.run('editor.place(250, 4)');
	await waitFor('edit after adoption converges', () => converged([a!, b!]));
	noErrors([a!, b!]);
}, 90000);

test('a large map joins and syncs without dropping the session', async () => {
	const big = notes(6000, 1000, 50);
	const { instances: [a, b] } = await setup({ a: big, b: [] });
	await host(a!);
	await join(a!, b!, true);
	await waitFor('large snapshot converges', () => converged([a!, b!]), 60000);
	expect(b!.get<number>('editor.noteCount()')).toBe(6000);

	a!.run('editor.placeBatch(2000, 400000)');
	await waitFor('large batch converges', () => converged([a!, b!]), 60000);
	expect(a!.syncState()).toBe('SYNCED');
	expect(b!.syncState()).toBe('SYNCED');
	expect(a!.peers()).toBe(1);
	noErrors([a!, b!]);
}, 180000);

test('failed plugin reads during editing neither lose nor duplicate edits', async () => {
	const { instances: [a, b] } = await setup({ a: notes(80), b: notes(80) });
	await host(a!);
	await join(a!, b!);
	for (let i = 0; i < 20; i++) {
		a!.failReads = 3;
		b!.failReads = 2;
		a!.run(`editor.place(${200000 + i * 100}, ${(i % 4) + 1})`);
		b!.run(`editor.place(${300000 + i * 100}, ${(i % 4) + 1})`);
		await Bun.sleep(40);
	}
	await waitFor('edits converge', () => converged([a!, b!]), 30000);
	expect(a!.get<number>('editor.noteCount()')).toBe(80 + 40);
	noErrors([a!, b!]);
}, 90000);

test('edits made while the window was closed are merged, host wins conflicts', async () => {
	const { instances: [a, b] } = await setup({ a: notes(60), b: notes(60) });
	await host(a!);
	await join(a!, b!);

	b!.setWindowOpen(false);
	a!.run('editor.place(5100, 1)');
	b!.run('editor.place(5200, 2)');
	b!.run('editor.place(30100, 3)');
	await Bun.sleep(11000);
	b!.setWindowOpen(true);

	await waitFor('merge converges', () => converged([a!, b!]), 30000);
	const map = a!.dump();
	expect(map).toContain('H5100:1');
	expect(map).not.toContain('H5200:2');
	expect(map).toContain('H30100:3');
	noErrors([a!, b!]);
}, 120000);

test('the joiner becomes host when the host leaves', async () => {
	const { instances: [a, b] } = await setup({ a: notes(40), b: notes(40) });
	await host(a!);
	await join(a!, b!);
	a!.click('Disconnect');
	await waitFor('joiner promoted', () => b!.get<boolean>('Network.isHost()') === true);
	expect(b!.syncState()).toBe('SYNCED');
	expect(b!.peers()).toBe(0);
	noErrors([a!, b!]);
}, 90000);

test('starting a second companion closes the first one', async () => {
	const { instances: [a] } = await setup({ a: notes(10) });
	const first = a!.companion!;
	const exited = new Promise((resolve) => first.once('exit', resolve));
	a!.startCompanion();
	await Promise.race([exited, Bun.sleep(15000)]);
	expect(first.exitCode !== null || first.signalCode !== null).toBe(true);
	await waitFor('plugin linked to the new companion', () => a!.alive(), 30000);
	noErrors([a!]);
}, 60000);

test('only the promoted player becomes host when the host leaves a group', async () => {
	const { instances: [a, b, c] } = await setup({ a: notes(40), b: notes(40), c: notes(40) });
	await host(a!);
	await join(a!, b!);
	await join(a!, c!);
	await waitFor('peers listed', () => b!.peers() === 2 && c!.peers() === 2);
	expect(b!.get<number>('(function() local n = 0 for _, p in ipairs(Network.collaborators) do if p.isHost then n = n + 1 end end return n end)()')).toBe(1);

	a!.click('Disconnect');
	await waitFor('someone promoted', () => [b!, c!].some((i) => i.get<boolean>('Network.isHost()') === true));
	await Bun.sleep(500);
	expect([b!, c!].filter((i) => i.get<boolean>('Network.isHost()') === true).length).toBe(1);
	noErrors([b!, c!]);
}, 90000);

test('a server restart drops a join that was not accepted yet', async () => {
	const { server, instances: [a, b] } = await setup({ a: notes(40), b: notes(40) });
	await host(a!);
	await waitFor('session listed', () => b!.sessions() >= 1);
	b!.click('Join##');
	await waitFor('joiner marker placed', () => b!.dump().includes('__MAP_FINDER__'));
	b!.save();
	await waitFor('host sees the joiner', () => a!.pendingJoiners().some((j) => j.descriptor));

	await server.close();
	const restarted = await startServer(server.port);
	cleanup.push(() => void restarted.close());

	await waitFor('joiner told the session was lost', () => b!.texts().some((t) => t.includes('The session was lost')), 30000);
	expect(b!.syncState()).toBe('IDLE');
	await waitFor('host resumed', () => a!.get<boolean>('Network.resuming') !== true && a!.syncState() === 'SYNCED', 30000);

	await join(a!, b!);
	a!.run('editor.place(777, 2)');
	await waitFor('the session syncs again', () => converged([a!, b!]));
	noErrors([a!, b!]);
}, 120000);

test('a third player joining mid-edit gets every edit exactly once', async () => {
	const { instances: [a, b, c] } = await setup({ a: notes(300), b: notes(300), c: notes(300) });
	await host(a!);
	await join(a!, b!);

	let editing = true;
	const editor = (async () => {
		for (let i = 0; editing; i++) {
			b!.run(`editor.place(${500000 + i * 10}, ${(i % 4) + 1})`);
			a!.run(`editor.place(${600000 + i * 10}, ${(i % 4) + 1})`);
			await Bun.sleep(30);
		}
	})();
	await join(a!, c!);
	await Bun.sleep(1500);
	editing = false;
	await editor;

	await waitFor('three maps converge', () => converged([a!, b!, c!]), 30000);
	expect(c!.peers()).toBe(2);
	noErrors([a!, b!, c!]);
}, 120000);

test('a companion restart ends the session cleanly and allows rejoining', async () => {
	const { instances: [a, b] } = await setup({ a: notes(40), b: notes(40) });
	await host(a!);
	await join(a!, b!);

	b!.stopCompanion();
	await waitFor('host sees the joiner leave', () => a!.peers() === 0, 30000);
	b!.startCompanion();
	await waitFor('joiner plugin back to the lobby', () => b!.alive() && !b!.get<boolean>('Network.isConnected()'), 45000);

	await join(a!, b!);
	a!.run('editor.place(888, 3)');
	await waitFor('rejoined session syncs', () => converged([a!, b!]));
	noErrors([a!, b!]);
}, 150000);

test('three players editing at random converge', async () => {
	const { instances } = await setup({ a: notes(150), b: notes(150), c: notes(150) });
	const [a, b, c] = instances;
	await host(a!);
	await join(a!, b!);
	await join(a!, c!);

	const seed = Number(process.env['FUZZ_SEED']) || Date.now() % 1000000;
	for (let i = 0; i < 300; i++) {
		instances.forEach((p, n) => p.run(`editor.randomEdit(${seed + i * 3 + n})`));
		await Bun.sleep(50);
	}

	await waitFor(`random edits converge (FUZZ_SEED=${seed})`, () => converged(instances), 60000);
	noErrors(instances);
}, 180000);

test('chaos: random edits, failed reads and short window closures converge', async () => {
	const { instances } = await setup({ a: notes(200), b: notes(200), c: notes(200) });
	const [a, b, c] = instances;
	await host(a!);
	await join(a!, b!);
	await join(a!, c!);

	const seed = Number(process.env['FUZZ_SEED']) || Date.now() % 1000000;
	let random = seed;
	const next = (): number => {
		random = (random * 16807) % 2147483647;
		return random / 2147483647;
	};
	for (let i = 0; i < 400; i++) {
		instances.forEach((p, n) => {
			p.run(`editor.randomEdit(${seed + i * 3 + n})`);
			if (next() < 0.05) p.failReads = 1 + Math.floor(next() * 5);
		});
		if (i % 100 === 50) {
			const closed = instances[1 + Math.floor(next() * 2)]!;
			closed.setWindowOpen(false);
			setTimeout(() => closed.setWindowOpen(true), 2000);
		}
		await Bun.sleep(40);
	}
	await Bun.sleep(2500);

	await waitFor(`chaos converges (FUZZ_SEED=${seed})`, () => converged(instances), 90000).catch((e: unknown) => {
		instances.forEach((p) => console.log(p.name, JSON.stringify(p.get('__Sync.status()')), p.get('__Perform.hash()'), p.get('#map.HitObjects'),
			'checks', p.log.filter((l) => l.includes('CHECK')).length, 'snapReq', p.log.filter((l) => l.includes('requested a snapshot')).length, 'snaps', p.log.filter((l) => l.includes('MESSAGE: SNAPSHOT')).length, 'errors', JSON.stringify(p.errors()).slice(0, 300)));
		const [ha, hb] = [a!.dump().split(' '), b!.dump().split(' ')];
		console.log('only a:', ha.filter((x) => !hb.includes(x)).slice(0, 20).join(' '));
		console.log('only b:', hb.filter((x) => !ha.includes(x)).slice(0, 20).join(' '));
		throw e;
	});
	expect(instances.every((p) => p.syncState() === 'SYNCED')).toBe(true);
	noErrors(instances);
}, 240000);

test('the companion replaces an outdated release plugin but never a dev one', async () => {
	const server = await startServer();
	const release = new Instance('release', server.url);
	const dev = new Instance('dev', server.url);
	cleanup.push(() => {
		release.stop();
		dev.stop();
		void server.close();
	});
	fs.writeFileSync(path.join(dev.pluginDir, 'settings.ini'), '[Settings]\nName = MapTogether-dev\n');
	for (const instance of [release, dev]) {
		instance.run('__CFG.version = "v0.0.1"');
		fs.writeFileSync(path.join(instance.pluginDir, 'plugin.lua'), '-- outdated');
		instance.startCompanion({ MT_PLUGIN_UPDATE: '1' });
	}

	await waitFor('release plugin replaced', () =>
		fs.readFileSync(path.join(release.pluginDir, 'plugin.lua'), 'utf8').includes('MapTogether - Quaver collaborative map editing'), 30000).catch((e: unknown) => {
		console.log(release.log.filter((l) => !l.includes('[You:')).join('|'), release.get('__IPC.isAlive()'), release.get('__CFG.version'));
		throw e;
	});
	await waitFor('dev companion linked', () => dev.alive(), 30000);
	await Bun.sleep(1000);
	expect(fs.readFileSync(path.join(dev.pluginDir, 'plugin.lua'), 'utf8')).toBe('-- outdated');
}, 90000);

test('the companion window lists lobbies and joins through the plugin', async () => {
	const { instances: [a, b] } = await setup({ a: notes(40), b: notes(40) });
	await waitFor('gui url logged', () => b!.guiUrl() !== undefined);
	const url = new URL(b!.guiUrl()!);
	const token = url.searchParams.get('token')!;
	const api = (route: string, init: RequestInit = {}, headers: Record<string, string> = { 'x-token': token }) =>
		fetch(new URL(route, url), { ...init, headers });

	expect((await fetch(url)).status).toBe(200);
	expect((await fetch(new URL('/', url))).status).toBe(403);
	expect((await api('/api/state', {}, {})).status).toBe(403);
	expect((await api('/api/state', {}, { 'x-token': token, host: 'evil.example' })).status).toBe(403);

	await host(a!);
	type Lobby = { id: string; host: string };
	const lobbies = async (): Promise<Lobby[]> => (await (await api('/api/state')).json() as { lobbies: Lobby[] }).lobbies;
	let listed: Lobby[] = [];
	await waitFor('lobby listed in the window', () => {
		void lobbies().then((l) => listed = l).catch(() => undefined);
		return listed.length === 1;
	});
	expect(listed[0]!.host).toBe('a');

	expect((await api('/api/join', { method: 'POST', body: JSON.stringify({ sessionId: listed[0]!.id }) })).status).toBe(200);
	await waitFor('joiner marker placed', () => b!.dump().includes('__MAP_FINDER__'));
	b!.save();
	await waitFor('joiner map identified', () => a!.pendingJoiners().some((j) => j.descriptor));
	a!.click('Accept##');
	await waitFor('joiner synced', () => b!.syncState() === 'SYNCED', 30000);

	type Session = { state: string; peers: { name: string }[] };
	let session: Session | undefined;
	await waitFor('window shows the session', () => {
		void api('/api/state').then(async (r) => session = (await r.json() as { session: Session }).session).catch(() => undefined);
		return session?.state === 'SYNCED' && session.peers.some((p) => p.name === 'a');
	});
	noErrors([a!, b!]);
}, 120000);

test('simultaneous conflicting edits still converge', async () => {
	const { instances: [a, b] } = await setup({ a: notes(40), b: notes(40) });
	await host(a!);
	await join(a!, b!);
	a!.run('editor.remove(1000, 1)');
	b!.run('editor.remove(1000, 1)');
	a!.run('editor.move({ { 1125, 2 } }, 1, 10)');
	b!.run('editor.move({ { 1250, 3 } }, -1, 20)');
	await waitFor('conflicting edits converge', () => converged([a!, b!]), 30000);
	noErrors([a!, b!]);
}, 90000);
