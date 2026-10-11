import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import IPC from '@quaver-ipc/main';

import { Lua } from './lua';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtg-ipc-'));
const configPath = path.join(dir, 'config.yaml');
IPC.setConfigPath(configPath);

const plugin = {
	received: [] as string[],
	writes: 0,
	failReads: 0,
};

const lua = new Lua();
lua.bindConfig(configPath, {
	failRead: () => plugin.failReads > 0 && plugin.failReads-- > 0,
	onWrite: () => plugin.writes++,
});
lua.register('received', ([n]) => {
	plugin.received.push(String(n));
	return undefined;
});
lua.register('print', () => undefined);

const run = (code: string): void => {
	expect(lua.run(code) ?? '').toBe('');
};

const source = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'quaver_ipc', 'main.lua'), 'utf8');
run(`
	imgui = { GetTime = function() return os.clock() + __offset end }
	__offset = 0
	state = { UnixTime = 1700000000000 }
	${source}
	_G.IPC = IPC
	IPC.onMessage(function(msg) received(msg.n) end)
	IPC.start()
`);

const companion = { received: [] as string[] };
IPC.listeners.message.on((msg) => companion.received.push(String(msg['n'])));

let elapsed = 0;
const pluginTick = setInterval(() => {
	elapsed += 0.02;
	run(`__offset = ${elapsed}; IPC.tick()`);
}, 20);

const waitFor = async (check: () => boolean, ms = 8000): Promise<boolean> => {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (check()) return true;
		await Bun.sleep(25);
	}
	return check();
};

const pluginAlive = (): boolean => lua.get('IPC.isAlive()') === true;

test('both sides connect', async () => {
	expect(await waitFor(() => IPC.isAlive() && pluginAlive())).toBe(true);
});

test('messages arrive exactly once and in order, both ways', async () => {
	for (let n = 1; n <= 40; n++) {
		run(`IPC.send({ type = "test", n = ${n} })`);
		void IPC.send({ type: 'test', n });
	}
	const big = Array.from({ length: 3000 }, (_, i) => ({ StartTime: i * 10, Lane: (i % 4) + 1 }));
	void IPC.send({ type: 'test', n: 'big', payload: big });
	run('IPC.send({ type = "test", n = "big-from-plugin" })');

	expect(await waitFor(() => plugin.received.length >= 41 && companion.received.length >= 41)).toBe(true);
	await Bun.sleep(500);

	const expected = Array.from({ length: 40 }, (_, i) => String(i + 1));
	expect(plugin.received).toEqual([...expected, 'big']);
	expect(companion.received).toEqual([...expected, 'big-from-plugin']);
});

test('failed reads do not redeliver messages', async () => {
	plugin.received.length = 0;
	void IPC.send({ type: 'test', n: 'before' });
	expect(await waitFor(() => plugin.received.length === 1)).toBe(true);

	plugin.failReads = 5;
	void IPC.send({ type: 'test', n: 'after' });
	expect(await waitFor(() => plugin.received.length === 2)).toBe(true);
	await Bun.sleep(500);
	expect(plugin.received).toEqual(['before', 'after']);
});

test('an idle link rarely rewrites the file', async () => {
	await Bun.sleep(500);
	const before = plugin.writes;
	await Bun.sleep(2000);
	expect(plugin.writes - before).toBeLessThanOrEqual(10);
	expect(IPC.isAlive() && pluginAlive()).toBe(true);
	clearInterval(pluginTick);
});
