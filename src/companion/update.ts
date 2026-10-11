import * as clack from '@clack/prompts';
import { spawn } from 'child_process';
import fs from 'fs';

import { IS_COMPILED } from '@lib/fs';

import { DOWNLOAD_URL } from '@mtg-shared/protocol';

import { VERSION } from '@mtg-companion/config';

export type Release = {
	version: string;
	url: string;
};

const PLATFORMS: Partial<Record<NodeJS.Platform, string>> = {
	win32: 'windows',
	linux: 'linux',
};
const CHECK_TIMEOUT_MS = 5000;

const downloadPath = (): string => `${process.execPath}.download`;
const oldPath = (): string => `${process.execPath}.old`;

export const removeOldVersion = (): void => {
	try {
		fs.unlinkSync(oldPath());
	} catch { /* ignored */ }
}

export const updateAndRestart = async (): Promise<boolean> => {
	const version = await installUpdate();
	if (!version) return false;

	clack.log.success(`Updated to ${version}, restarting…`);
	restart();
	return true;
}

export const restart = (env: Record<string, string> = {}, args = process.argv.slice(2)): void => {
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.removeAllListeners(signal);
		process.on(signal, () => { /* the new companion handles it */ });
	}
	const child = spawn(process.execPath, args, {
		stdio: 'inherit',
		env: {
			...process.env,
			...env,
		},
	});
	child.on('exit', (code) => process.exit(code ?? 0));
	child.on('error', (e) => {
		clack.log.error(`Could not start the updated companion: ${e.message}. Start it again manually.`);
		process.exit(1);
	});
}

export const updatesEnabled = (): boolean => IS_COMPILED && !process.env['MT_NO_UPDATE'];

export const installUpdate = async (): Promise<string | undefined> => {
	if (!updatesEnabled()) return;

	const release = await latestRelease();
	if (!release || !isNewer(release.version, VERSION)) return;

	clack.log.info(`Companion ${release.version} is available (you have ${VERSION}).`);
	if (!await applyRelease(release)) return;
	return release.version;
}

export const applyRelease = async (release: Release): Promise<boolean> => await download(release.url) && swap();

export const latestRelease = async (): Promise<Release | undefined> => {
	const platform = PLATFORMS[process.platform];
	if (!platform) return;
	try {
		const res = await fetch(`${DOWNLOAD_URL}/releases/versions.php?os=${platform}`, {
			redirect: 'manual',
			signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
		});
		const url = res.headers.get('location');
		const version = url?.match(/\/(v\d+\.\d+\.\d+)\//)?.[1];
		if (!url || !version) return;
		return {
			version,
			url,
		};
	} catch {
		return;
	}
}

const download = async (url: string): Promise<boolean> => {
	const spinner = clack.spinner();
	spinner.start('Downloading update');
	const fail = (reason: string): boolean => {
		spinner.stop(`Update failed: ${reason}`);
		try {
			fs.unlinkSync(downloadPath());
		} catch { /* ignored */ }
		return false;
	};

	let res: Response;
	try {
		res = await fetch(url);
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e));
	}
	if (!res.ok || !res.body) return fail(`HTTP ${res.status}`);

	const total = Number(res.headers.get('content-length')) || 0;
	let received = 0;
	try {
		const file = fs.openSync(downloadPath(), 'w');
		try {
			for await (const chunk of res.body) {
				fs.writeSync(file, chunk);
				received += chunk.length;
				if (total) spinner.message(`Downloading update ${Math.floor(received / total * 100)}%`);
			}
		} finally {
			fs.closeSync(file);
		}
		fs.chmodSync(downloadPath(), 0o755);
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e));
	}

	if (total && received !== total) return fail('incomplete download');
	spinner.stop('Update downloaded');
	return true;
}

const swap = (): boolean => {
	removeOldVersion();
	try {
		if (process.platform === 'win32') fs.renameSync(process.execPath, oldPath());
		fs.renameSync(downloadPath(), process.execPath);
		return true;
	} catch (e) {
		clack.log.warn(`Could not install the update: ${e instanceof Error ? e.message : String(e)}`);
		try {
			if (!fs.existsSync(process.execPath)) fs.renameSync(oldPath(), process.execPath);
		} catch { /* ignored */ }
		return false;
	}
}

export const isNewer = (candidate: string, current: string): boolean => {
	const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
	const a = parse(candidate);
	const b = parse(current);
	for (let i = 0; i < 3; i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return false;
}
