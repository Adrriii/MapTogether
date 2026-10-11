import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

import { findQuaverDirs, workshopDirOf } from '@mtg-companion/quaver-dir';

const PLUGIN_NAME = /^\s*Name\s*=\s*MapTogether/m;

export const findPluginDirs = (songsDir: string, quaverDirs = findQuaverDirs(songsDir)): string[] => {
	const roots = quaverDirs.flatMap((dir) => [path.join(dir, 'Plugins'), workshopDirOf(dir)]);
	const dirs = [process.cwd(), ...roots.flatMap(listDirs)];
	return [...new Set(dirs.map((dir) => path.resolve(dir)))].filter(isPluginDir);
}

export const newestConfigPath = (dirs: string[]): string | undefined => {
	let newest: { file: string; startedAt: number } | undefined;
	for (const dir of dirs) {
		const file = path.join(dir, 'config.yaml');
		const startedAt = pluginStartedAt(file);
		if (!newest || startedAt > newest.startedAt) newest = {
			file,
			startedAt,
		};
	}
	return newest?.file;
}

const listDirs = (root: string): string[] => {
	try {
		return fs.readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(root, entry.name));
	} catch {
		return [];
	}
}

const isPluginDir = (dir: string): boolean => {
	try {
		return PLUGIN_NAME.test(fs.readFileSync(path.join(dir, 'settings.ini'), 'utf8'))
			&& fs.existsSync(path.join(dir, 'plugin.lua'));
	} catch {
		return false;
	}
}

const pluginStartedAt = (file: string): number => {
	try {
		const doc = yaml.load(fs.readFileSync(file, 'utf8')) as { plugin?: { rev?: unknown } } | undefined;
		return Number(doc?.plugin?.rev) || 0;
	} catch {
		return 0;
	}
}
