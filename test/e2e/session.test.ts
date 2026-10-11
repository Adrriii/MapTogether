import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { buildPlugin, Instance, startServer, waitFor } from './harness';

const NOTES = Array.from({ length: 200 }, (_, i) => [1000 + i * 125, (i % 4) + 1]);

let server: Awaited<ReturnType<typeof startServer>>;
let host: Instance;
let joiner: Instance;

beforeAll(async () => {
	buildPlugin();
	server = await startServer();
	host = new Instance('host', server.url);
	joiner = new Instance('joiner', server.url);
	for (const instance of [host, joiner]) {
		instance.run(`editor.load(${toLua(NOTES)})`);
		instance.startCompanion();
	}
	await waitFor('companions linked', () => host.alive() && joiner.alive(), 30000);
}, 60000);

afterAll(() => {
	for (const instance of [host, joiner].filter(Boolean)) {
		if (process.env['E2E_LOGS']) console.log(`--- ${instance.name}\n${instance.log.join('\n')}`);
	}
	host?.stop();
	joiner?.stop();
	void server?.close();
});

const converged = (): boolean => host.dump() === joiner.dump();

test('host and joiner end up in the same session', async () => {
	host.click('Host this map');
	await waitFor('host marker placed', () => host.dump().includes('__MAP_FINDER__'));
	host.save();
	await waitFor('host synced', () => host.syncState() === 'SYNCED');
	await waitFor('session listed for joiner', () => joiner.sessions() === 1);

	joiner.click('Join##');
	await waitFor('joiner marker placed', () => joiner.dump().includes('__MAP_FINDER__'));
	await waitFor('host sees joiner', () => host.pendingJoiners().length === 1);
	joiner.save();
	await waitFor('joiner map identified', () => host.pendingJoiners()[0]?.descriptor !== undefined);

	joiner.run('editor.performed = 0');
	host.click('Accept##');
	await waitFor('joiner synced', () => joiner.syncState() === 'SYNCED');
	await waitFor('peers see each other', () => host.peers() === 1 && joiner.peers() === 1);

	expect(joiner.get<number>('editor.performed')).toBeLessThanOrEqual(2);
	expect(converged()).toBe(true);
}, 60000);

test('edits flow both ways and converge', async () => {
	host.run('editor.place(500, 1)');
	joiner.run('editor.place(600, 2)');
	host.run('editor.move({ { 1000, 1 }, { 1125, 2 } }, 1, 50)');
	joiner.run('editor.remove(1250, 3)');
	host.run('editor.addTimingPoint(30000, 200)');
	await waitFor('maps converge', converged);

	joiner.run('editor.undo()');
	host.run('editor.undo()');
	await waitFor('undos converge', converged);
	expect(joiner.dump()).toContain('H1250:3');

	joiner.run('editor.redo()');
	await waitFor('redo converges', converged);
	expect(joiner.dump()).not.toContain('H1250:3');

	expect(host.errors()).toEqual([]);
	expect(joiner.errors()).toEqual([]);
}, 60000);

test('clicking a collaborator moves the editor to their position', async () => {
	host.run('state.SongTime = 12345');
	await waitFor('joiner sees the host move', () => joiner.texts().includes('00:12.345'));
	joiner.click('host');
	await waitFor('joiner jumps to the host', () => joiner.get<number>('state.SongTime') === 12345);
}, 30000);

test('mines, hit sounds and signatures reach the other side as Quaver values', async () => {
	host.run('editor.place(700, 3, 0, "Mine", "Whistle")');
	host.run('editor.addTimingPoint(40000, 150, "Triple")');
	await waitFor('maps converge', converged);
	expect(joiner.dump()).toContain('H700:3:0:Mine:0:$Default:Whistle');
	expect(joiner.dump()).toContain('T40000:150:Triple');

	host.run('editor.undo()');
	host.run('editor.undo()');
	await waitFor('undos converge', converged);
	expect(joiner.dump()).not.toContain('H700:3');

	expect(host.errors()).toEqual([]);
	expect(joiner.errors()).toEqual([]);
}, 60000);

test('a long note dragged out right after placing reaches the other side without a resync', async () => {
	const snapshots = (): number => server.log.join('').split('sends a snapshot').length;
	const before = snapshots();
	host.run('editor.mouseDown = true');
	host.run('__ln = editor.place(800, 2)');
	await Bun.sleep(100);
	host.run('__ln.EndTime = 1200');
	await Bun.sleep(100);
	host.run('editor.mouseDown = false');
	await waitFor('maps converge', converged);
	expect(joiner.dump()).toContain('H800:2:1200');
	expect(snapshots()).toBe(before);

	host.run('editor.undo()');
	await waitFor('undo converges', converged);
	expect(joiner.dump()).not.toContain('H800:2');
	expect(host.errors()).toEqual([]);
	expect(joiner.errors()).toEqual([]);
}, 60000);

test('a host can let people download their saved map', async () => {
	const guest = new Instance('guest', server.url);
	const mapset = path.join(guest.songsDir, '100 - Test Song');
	fs.rmSync(mapset, { recursive: true });
	guest.startCompanion();
	try {
		await waitFor('guest companion window', () => guest.guiUrl() !== undefined, 30000);
		const url = new URL(guest.guiUrl() ?? '');
		const call = async (route: string, body?: object): Promise<{ status: number; json: Record<string, any> }> => {
			const res = await fetch(new URL(route, url), {
				method: body ? 'POST' : 'GET',
				headers: { 'x-token': url.searchParams.get('token') ?? '' },
				...(body && { body: JSON.stringify(body) }),
			});
			return { status: res.status, json: await res.json() as Record<string, any> };
		};
		const until = async (label: string, check: () => Promise<boolean>): Promise<void> => {
			for (let i = 0; i < 300; i++) {
				if (await check()) return;
				await Bun.sleep(50);
			}
			throw new Error(`timed out waiting for: ${label}`);
		};

		let lobby: Record<string, any> | undefined;
		await until('lobby listed', async () => {
			lobby = (await call('/api/state')).json['lobbies'][0];
			return lobby !== undefined;
		});
		expect(lobby?.['sharing']).toBe(false);
		expect((await call('/api/download', { sessionId: lobby?.['id'] })).status).toBe(409);

		host.click('Let people download my map');
		await until('lobby shared', async () => (await call('/api/state')).json['lobbies'][0]?.['sharing'] === true);

		const hostQua = fs.readFileSync(path.join(host.songsDir, '100 - Test Song', 'map.qua'));
		const fakeQuaver = path.join(guest.quaverDir, process.platform === 'win32' ? 'Quaver.exe' : 'Quaver');
		const fakeSource = path.join(guest.quaverDir, 'fake-quaver.ts');
		const imported = path.join(guest.quaverDir, 'imported.qp');
		fs.writeFileSync(fakeSource, "import fs from 'fs';\nimport path from 'path';\nfs.copyFileSync(process.argv[2] ?? '', path.join(path.dirname(process.execPath), 'imported.qp'));\n");
		spawnSync('bun', ['build', '--compile', `--outfile=${fakeQuaver}`, fakeSource]);
		expect((await call('/api/download', { sessionId: lobby?.['id'] })).status).toBe(200);
		await until('map handed to Quaver', async () => fs.existsSync(imported));
		await Bun.sleep(200);
		const qp = fs.readFileSync(imported);
		expect(qp.subarray(0, 4).toString('binary')).toBe('PK\x03\x04');
		expect(qp.includes(hostQua)).toBe(true);
		expect(fs.existsSync(mapset)).toBe(false);
		fs.rmSync(fakeQuaver);

		expect((await call('/api/download', { sessionId: lobby?.['id'] })).status).toBe(200);
		await until('map downloaded', async () => (await call('/api/state')).json['download']?.['status'] === 'done');
		expect(fs.readFileSync(path.join(mapset, 'map.qua'), 'utf8'))
			.toBe(fs.readFileSync(path.join(host.songsDir, '100 - Test Song', 'map.qua'), 'utf8'));

		fs.writeFileSync(path.join(mapset, 'map.qua'), 'my own edits');
		fs.writeFileSync(path.join(mapset, 'mine.qua'), 'another difficulty');
		expect((await call('/api/download', { sessionId: lobby?.['id'] })).status).toBe(200);
		await until('overwrite offered', async () => (await call('/api/state')).json['download']?.['status'] === 'exists');
		expect(fs.readFileSync(path.join(mapset, 'map.qua'), 'utf8')).toBe('my own edits');

		expect((await call('/api/download/overwrite', {})).status).toBe(200);
		expect((await call('/api/state')).json['download']['status']).toBe('done');
		expect(fs.readFileSync(path.join(mapset, 'map.qua'), 'utf8'))
			.toBe(fs.readFileSync(path.join(host.songsDir, '100 - Test Song', 'map.qua'), 'utf8'));
		expect(fs.readFileSync(path.join(mapset, 'mine.qua'), 'utf8')).toBe('another difficulty');
		expect((await call('/api/download/overwrite', {})).status).toBe(409);

		host.click('Let people download my map');
		await until('sharing stopped', async () => (await call('/api/state')).json['lobbies'][0]?.['sharing'] === false);
	} finally {
		guest.stop();
	}
}, 60000);

const toLua = (value: unknown): string => {
	if (Array.isArray(value)) return `{ ${value.map(toLua).join(', ')} }`;
	return JSON.stringify(value);
};

test('undoing past the session start does not undo the removed map marker', async () => {
	for (let i = 0; i < 20; i++) host.run('editor.undo()');
	for (let i = 0; i < 20; i++) joiner.run('editor.undo()');
	await waitFor('undos converge', converged);
	expect(host.errors()).toEqual([]);
	expect(joiner.errors()).toEqual([]);
}, 60000);

test('a peer cursor bookmark follows the peer instead of being recreated', async () => {
	const cursors = (): string => host.get<string>(`(function()
		local out = {}
		for _, b in ipairs(map.Bookmarks) do
			if tostring(b.Note):match("^>> ") then table.insert(out, b.StartTime) end
		end
		return table.concat(out, ",")
	end)()`);
	joiner.run('state.SongTime = 4000');
	await waitFor('cursor bookmark placed', () => cursors() === '4000');
	host.run('for _, b in ipairs(map.Bookmarks) do if tostring(b.Note):match("^>> ") then __cursor = b end end');
	joiner.run('state.SongTime = 6000');
	await waitFor('cursor bookmark moved', () => cursors() === '6000');
	expect(host.get<boolean>('__cursor.StartTime == 6000')).toBe(true);
	expect(host.errors()).toEqual([]);
}, 60000);

test('messages between plugin and companion travel as packed payloads', async () => {
	const config = (instance: Instance): string => fs.readFileSync(path.join(instance.pluginDir, 'config.yaml'), 'utf8');
	const seen = { plugin: false, companion: false };
	const watch = (): boolean => {
		const text = config(host) + config(joiner);
		seen.plugin ||= /id: p\d+\s+session: \S+\s+data: /.test(text);
		seen.companion ||= /id: c\w+-\d+\s+session: \S+\s+data: /.test(text);
		return seen.plugin && seen.companion;
	};
	host.run('editor.place(700, 3)');
	await waitFor('packed messages both ways', watch);
	await waitFor('maps converge', converged);
}, 60000);
