import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { findPluginDirs, newestConfigPath } from '@mtg-companion/plugin-dir';
import { findQuaverDirs, readQuaverConfig } from '@mtg-companion/quaver-dir';

const layout = (cfg: (root: string) => string) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtg-dirs-'));
	const library = path.join(root, 'SteamLibrary');
	const quaver = path.join(library, 'steamapps', 'common', 'Quaver');
	const workshopPlugin = path.join(library, 'steamapps', 'workshop', 'content', '980610', '3816719266');
	for (const dir of [quaver, workshopPlugin]) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(quaver, 'quaver.cfg'), `[Config]\nUsername = A6sT\n${cfg(root)}`);
	fs.writeFileSync(path.join(workshopPlugin, 'settings.ini'), '[Settings]\nName = MapTogether\n');
	fs.writeFileSync(path.join(workshopPlugin, 'plugin.lua'), '');
	return { root, library, quaver, workshopPlugin };
};

test('finds the Workshop plugin when the config has no Workshop line', () => {
	const { library, quaver, workshopPlugin } = layout(() => '');
	const songs = path.join(quaver, 'Songs');
	const dirs = findQuaverDirs(songs, [library]);
	expect(dirs).toEqual([quaver]);
	expect(findPluginDirs(songs, dirs)).toContain(workshopPlugin);
});

test('follows the most recently started plugin, not the file the companion last wrote', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtg-ipc-'));
	const [started, followed] = ['workshop', 'dev'].map((name) => path.join(root, name));
	for (const dir of [started!, followed!]) fs.mkdirSync(dir);
	fs.writeFileSync(path.join(started!, 'config.yaml'), 'session: a\nplugin:\n  ro:\n    cursor: 0\n  rev: 2000\ncompanion:\n- \n');
	fs.writeFileSync(path.join(followed!, 'config.yaml'), 'session: b\nplugin:\n  ro:\n    cursor: 0\n  rev: 1000\ncompanion:\n  ro:\n    ping: 5\n  rev: 9\n');
	fs.utimesSync(path.join(started!, 'config.yaml'), new Date(1000), new Date(1000));
	expect(newestConfigPath([followed!, started!])).toBe(path.join(started!, 'config.yaml'));
});

test('finds the install and its username through Steam when Songs is elsewhere', () => {
	const { root, library, quaver, workshopPlugin } = layout((r) => `SongDirectory = ${path.join(r, 'MySongs')}\n`);
	const songs = path.join(root, 'MySongs');
	fs.mkdirSync(songs);
	const dirs = findQuaverDirs(songs, [library]);
	expect(dirs).toEqual([quaver]);
	expect(readQuaverConfig(quaver, 'Username')).toBe('A6sT');
	expect(findPluginDirs(songs, dirs)).toContain(workshopPlugin);
});
