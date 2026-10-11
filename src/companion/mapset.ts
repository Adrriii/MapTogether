import * as clack from '@clack/prompts';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { COMPANION_MESSAGE } from '@mtg-shared/companion_message';
import { MapsetFile } from '@mtg-shared/mapset';
import { SERVER_MESSAGE, ServerMessageOfType } from '@mtg-shared/server_message';

import { wsSend } from '@mtg-companion/handle_server_message';
import { writeQp } from '@mtg-companion/qp';
import { findQuaverDirs } from '@mtg-companion/quaver-dir';
import { state } from '@mtg-companion/state';

const MAX_MAPSET_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60000;
const UNSAFE_NAME = /[<>:"|?*\x00-\x1f]/;

let timeout: ReturnType<typeof setTimeout> | undefined;
let held: { target: string; name: string; files: MapsetFile[] } | undefined;

export const requestMapset = (sessionId: string): void => {
	state.download = {
		sessionId,
		status: 'waiting',
		message: 'Asking the host for their map…',
	};
	wsSend({
		type: COMPANION_MESSAGE.MAPSET_REQUEST,
		sessionId,
	});
	clearTimeout(timeout);
	timeout = setTimeout(() => finish('failed', 'The host did not answer. Try again in a moment.'), DOWNLOAD_TIMEOUT_MS);
}

export const sendMapset = (msg: ServerMessageOfType<typeof SERVER_MESSAGE.MAPSET_REQUEST>): void => {
	const reply = (body: { name?: string; files?: MapsetFile[]; error?: string }): void => wsSend({
		type: COMPANION_MESSAGE.MAPSET,
		targetId: msg.requesterId,
		...body,
	});

	if (!state.sharing) return reply({ error: 'This host does not share their map.' });
	if (!state.mapFile) return reply({ error: 'The host has not saved their map yet.' });

	const dir = path.dirname(state.mapFile);
	const files = readMapset(dir);
	if (!files) return reply({ error: 'The host\'s map is too large or could not be read.' });

	clack.log.info(`Sending your map to ${msg.username}.`);
	reply({
		name: path.basename(dir),
		files,
	});
}

export const receiveMapset = (msg: ServerMessageOfType<typeof SERVER_MESSAGE.MAPSET>): void => {
	if (state.download?.status !== 'waiting') return;
	if (msg.error || !msg.name || !msg.files) return finish('failed', msg.error ?? 'The host sent nothing.');

	const name = safeName(msg.name);
	if (!state.songsDir || !name) return finish('failed', 'The map could not be saved.');

	const target = path.join(state.songsDir, name);
	if (fs.existsSync(target)) {
		held = {
			target,
			name,
			files: msg.files, 
		};
		return finish('exists', `You already have Songs/${name}. Overwrite it with the host's version?`);
	}
	importIntoQuaver(target, name, msg.files);
}

export const overwriteMapset = (): boolean => {
	if (!held || state.download?.status !== 'exists') return false;
	save(held.target, held.name, held.files);
	return true;
}

const save = (target: string, name: string, files: MapsetFile[]): void => {
	held = undefined;
	try {
		fs.mkdirSync(target, { recursive: true });
		for (const file of files) {
			const fileName = safeName(file.name);
			if (fileName) fs.writeFileSync(path.join(target, fileName), Buffer.from(file.data, 'base64'));
		}
	} catch (e) {
		clack.log.warn(`Could not save the downloaded map: ${e instanceof Error ? e.message : String(e)}`);
		return finish('failed', 'The map could not be saved, see the companion console.');
	}
	clack.log.success(`Downloaded the host's map to ${target}`);
	finish('done', `Saved to Songs/${name}. Restart Quaver if it does not show up, then open it in the editor and join the session.`);
}

const importIntoQuaver = (target: string, name: string, files: MapsetFile[]): void => {
	const exe = quaverExecutable();
	if (!exe) return save(target, name, files);

	const qp = path.join(os.tmpdir(), 'maptogether-maps', `${name}.qp`);
	try {
		fs.mkdirSync(path.dirname(qp), { recursive: true });
		fs.writeFileSync(qp, writeQp(files.flatMap((file) => {
			const fileName = safeName(file.name);
			return fileName ? [{
				name: fileName,
				data: Buffer.from(file.data, 'base64'), 
			}] : [];
		})));
	} catch (e) {
		clack.log.warn(`Could not pack the downloaded map: ${e instanceof Error ? e.message : String(e)}`);
		return save(target, name, files);
	}

	const child = spawn(exe, [qp], {
		cwd: path.dirname(exe),
		detached: true,
		stdio: 'ignore',
		windowsHide: true,
	});
	child.on('error', (e) => {
		clack.log.warn(`Could not hand the map to Quaver: ${e.message}`);
		save(target, name, files);
	});
	child.unref();
	clack.log.success(`Handed the host's map to Quaver: ${qp}`);
	finish('done', 'Sent to Quaver, which imports it on song select. Then open it in the editor and join the session.');
}

const quaverExecutable = (): string | undefined => {
	const dir = findQuaverDirs(state.songsDir ?? undefined)[0];
	if (!dir) return;
	const exe = path.join(dir, process.platform === 'win32' ? 'Quaver.exe' : 'Quaver');
	return fs.existsSync(exe) ? exe : undefined;
}

const finish = (status: 'done' | 'failed' | 'exists', message: string): void => {
	clearTimeout(timeout);
	if (!state.download) return;
	state.download = {
		...state.download,
		status,
		message,
	};
}

const readMapset = (dir: string): MapsetFile[] | undefined => {
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile());
		const total = entries.reduce((sum, entry) => sum + fs.statSync(path.join(dir, entry.name)).size, 0);
		if (total > MAX_MAPSET_BYTES) return;
		return entries.map((entry) => ({
			name: entry.name,
			data: fs.readFileSync(path.join(dir, entry.name)).toString('base64'),
		}));
	} catch (e) {
		clack.log.warn(`Could not read your map folder: ${e instanceof Error ? e.message : String(e)}`);
		return;
	}
}

const safeName = (name: string): string | undefined => {
	const base = path.basename(name.replace(/\\/g, '/'));
	if (!base || base === '.' || base === '..' || UNSAFE_NAME.test(base)) return;
	return base;
}
