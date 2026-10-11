import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STEAM_APP_ID = 980610;

export const findQuaverDirs = (songsDir?: string, steamLibraryDirs = steamRoots().flatMap(steamLibraries)): string[] => {
	const candidates = [
		...(songsDir ? [path.dirname(songsDir)] : []),
		...steamLibraryDirs.map((library) => path.join(library, 'steamapps', 'common', 'Quaver')),
	];
	const found = [...new Set(candidates.map((dir) => path.resolve(dir)))]
		.filter((dir) => fs.existsSync(path.join(dir, 'quaver.cfg')));
	if (!songsDir) return found;
	const owners = found.filter((dir) => path.resolve(songsDirOf(dir)).toLowerCase() === path.resolve(songsDir).toLowerCase());
	return owners.length > 0 ? owners : found;
}

export const readQuaverConfig = (quaverDir: string, key: string): string | undefined => {
	try {
		const cfg = fs.readFileSync(path.join(quaverDir, 'quaver.cfg'), 'utf8');
		return cfg.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim();
	} catch {
		return;
	}
}

export const songsDirOf = (quaverDir: string): string => {
	const configured = readQuaverConfig(quaverDir, 'SongDirectory');
	return configured ? path.resolve(quaverDir, configured) : path.join(quaverDir, 'Songs');
}

export const workshopDirOf = (quaverDir: string): string => {
	const configured = readQuaverConfig(quaverDir, 'SteamWorkshopDirectory');
	return path.resolve(configured ?? path.join(quaverDir, '..', '..', 'workshop', 'content', String(STEAM_APP_ID)));
}

const steamRoots = (): string[] => {
	if (process.platform !== 'win32') {
		const home = os.homedir();
		return [
			path.join(home, '.steam', 'steam'),
			path.join(home, '.local', 'share', 'Steam'),
			path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
		];
	}

	const roots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
	try {
		const reg = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'reg.exe');
		const out = execSync(`"${reg}" query "HKCU\\Software\\Valve\\Steam" /v SteamPath`, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			windowsHide: true,
		});
		const registered = out.match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1]?.trim();
		if (registered) roots.unshift(path.normalize(registered));
	} catch { /* ignored */ }
	return roots;
}

const steamLibraries = (root: string): string[] => {
	try {
		const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
		const paths = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => (m[1] ?? '').replace(/\\\\/g, '\\'));
		return [root, ...paths];
	} catch {
		return [root];
	}
}
