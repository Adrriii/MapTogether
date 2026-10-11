import { afterEach, beforeAll, expect, test } from 'bun:test';

import { buildPlugin, converged, host, Instance, join, launch, notes, startServer, waitFor } from './harness';

type Server = Awaited<ReturnType<typeof startServer>>;

const ENV = { MT_RESUME_WAIT_MS: '1500' };

let cleanup: (() => void)[] = [];

beforeAll(() => buildPlugin());

afterEach(() => {
	cleanup.forEach((fn) => fn());
	cleanup = [];
});

const setup = async (players: Record<string, number[][]>) => {
	const servers: Server[] = [await startServer(undefined, ENV)];
	const instances = await launch(servers[0]!.url, players);
	cleanup.push(() => {
		if (process.env['E2E_LOGS']) instances.forEach((i) => console.log(`--- ${i.name}`, i.log.filter((l) => !l.includes('[You:') && !l.includes('CURSOR')).slice(-40).join('|')));
		instances.forEach((i) => i.stop());
		servers.forEach((s) => void s.close());
	});
	const restart = async (during: () => void): Promise<void> => {
		const old = servers[servers.length - 1]!;
		await old.close();
		await waitFor('companions notice the drop', () => instances.every((i) => i.get<boolean>('Network.resuming') || !i.alive()), 15000);
		during();
		servers.push(await startServer(old.port, ENV));
	};
	return {
		instances,
		restart,
	};
};

const noErrors = (instances: Instance[]): void => {
	for (const instance of instances) expect({ name: instance.name, errors: instance.errors() }).toEqual({ name: instance.name, errors: [] });
};

test('a session survives a server restart and keeps everyone\'s gap edits', async () => {
	const { instances: [a, b], restart } = await setup({ a: notes(40), b: notes(40) });
	await host(a!);
	await join(a!, b!);
	await waitFor('maps converge', () => converged([a!, b!]));

	await restart(() => {
		a!.run('editor.place(20000, 1)');
		b!.run('editor.place(30000, 2)');
		a!.run('editor.place(40000, 1)');
		b!.run('editor.place(40500, 3)');
		a!.run('editor.remove(5875, 4)');
		b!.run('editor.remove(1000, 1)');
	});

	await waitFor('session resumed', () => !a!.get<boolean>('Network.resuming') && !b!.get<boolean>('Network.resuming'), 30000);
	await waitFor('peers back', () => a!.peers() === 1 && b!.peers() === 1, 30000);
	await waitFor('maps converge', () => converged([a!, b!]), 30000);

	const map = a!.dump();
	expect(map).toContain('H20000:1:');
	expect(map).toContain('H30000:2:');
	expect(map).toContain('H40000:1:');
	expect(map).not.toContain('H40500:');
	expect(map).not.toContain('H5875:4:');
	expect(map).not.toContain('H1000:1:');
	expect(a!.get<string>('Network.role')).toBe('host');
	expect(b!.get<string>('Network.role')).toBe('joiner');

	a!.run('editor.place(50000, 1)');
	b!.run('editor.place(60000, 2)');
	await waitFor('live edits flow again', () => converged([a!, b!]) && a!.dump().includes('H60000:2:') && b!.dump().includes('H50000:1:'));
	noErrors([a!, b!]);
}, 120000);

test('a joiner takes over when the host does not come back', async () => {
	const { instances: [a, b, c], restart } = await setup({ a: notes(40), b: notes(40), c: notes(40) });
	await host(a!);
	await join(a!, b!);
	await join(a!, c!);
	await waitFor('maps converge', () => converged([a!, b!, c!]));

	await restart(() => {
		a!.stop();
		b!.run('editor.place(20000, 1)');
		c!.run('editor.place(30000, 2)');
	});

	await waitFor('one joiner hosts', () => [b!, c!].filter((i) => i.get<string>('Network.role') === 'host').length === 1, 30000);
	await waitFor('peers back', () => b!.peers() === 1 && c!.peers() === 1, 30000);
	await waitFor('maps converge', () => converged([b!, c!]), 30000);
	expect(b!.dump()).toContain('H20000:1:');
	expect(b!.dump()).toContain('H30000:2:');
	noErrors([b!, c!]);
}, 120000);
