import * as clack from '@clack/prompts';
import pluginSource from '@root/plugin.lua' with { type: 'text' };
import fs from 'fs';
import path from 'path';

import { IS_COMPILED } from '@lib/fs';

import IPC from '@quaver-ipc/main';

import { VERSION } from '@mtg-companion/config';
import { state, SYNC_STATE } from '@mtg-companion/state';
import { isNewer } from '@mtg-companion/update';

const RELEASE_NAME = /^\s*Name\s*=\s*MapTogether\s*$/m;

const attempted = new Set<string>();

export const refreshPlugin = (): void => {
	if (!pluginUpdatesEnabled()) return;
	if (!IPC.isAlive() || state.syncState !== SYNC_STATE.IDLE) return;
	if (!pluginOutdated()) return;

	const dir = path.dirname(IPC.getConfigPath());
	if (attempted.has(dir)) return;
	attempted.add(dir);
	updatePlugin();
}

export const pluginUpdatesEnabled = (): boolean =>
	(IS_COMPILED || !!process.env['MT_PLUGIN_UPDATE']) && !process.env['MT_NO_PLUGIN_UPDATE'];

export const pluginOutdated = (): boolean => {
	const reported = IPC.get('pluginVersion');
	return typeof reported !== 'string' || isNewer(VERSION, reported);
}

export const updatePlugin = (): boolean => {
	const dir = path.dirname(IPC.getConfigPath());
	if (!installPlugin(dir, pluginSource)) return false;
	clack.log.success(`Updated the MapTogether plugin to ${VERSION} (${dir}).`);
	return true;
}

export const installPlugin = (dir: string, source: string): boolean => {
	if (!isReleasePlugin(dir)) return false;

	const target = path.join(dir, 'plugin.lua');
	const temp = `${target}.download`;
	try {
		fs.writeFileSync(temp, source, 'utf8');
		fs.renameSync(temp, target);
		return true;
	} catch (e) {
		clack.log.warn(`Could not update the plugin in ${dir}: ${e instanceof Error ? e.message : String(e)}`);
		try {
			fs.unlinkSync(temp);
		} catch { /* ignored */ }
		return false;
	}
}

const isReleasePlugin = (dir: string): boolean => {
	try {
		return RELEASE_NAME.test(fs.readFileSync(path.join(dir, 'settings.ini'), 'utf8'));
	} catch {
		return false;
	}
}
