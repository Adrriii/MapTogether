#!/usr/bin/env bun

import * as clack from '@clack/prompts';
import { execSync } from 'child_process';
import path from 'path';

import IPC from '@quaver-ipc/main';

import { LOCK_PATH, PERSIST_PATH } from '@mtg-companion/config';
import { openInBrowser, startGui } from '@mtg-companion/gui';
import { setupIpcHandler } from '@mtg-companion/handle_ipc_message';
import { wsConnect, wsStop } from '@mtg-companion/handle_server_message';
import { acquireLock } from '@mtg-companion/lock';
import { initIPC } from '@mtg-companion/mtg_ipc';
import { findPluginDirs, newestConfigPath } from '@mtg-companion/plugin-dir';
import { findQuaverDirs, readQuaverConfig } from '@mtg-companion/quaver-dir';
import { getSongsDir } from '@mtg-companion/songs-dir';
import { state } from '@mtg-companion/state';
import { removeOldVersion, restart, updateAndRestart } from '@mtg-companion/update';

const SERVER_URL = process.env['MT_SERVER'] ?? 'wss://qmtg.rhythmgamers.net';
const RESET_FLAG = process.argv.includes('--reset') || process.argv.includes('-r');
const PLUGIN_SCAN_MS = 2000;

const fatalError = (msg: string): never => {
	process.stderr.write('\nError: ' + msg + '\n\n');
	if (process.platform === 'win32') {
		try {
			execSync('pause', {
				stdio: 'inherit',
				shell: process.env['COMSPEC'] ?? 'cmd.exe',
			});
		} catch { /* ignored */ }
	} else {
		process.stderr.write('Press Enter to exit...');
		try {
			execSync('read -r _', {
				stdio: 'inherit',
				shell: '/bin/sh',
			});
		} catch { /* ignored */ }
	}
	process.exit(1);
}

const followPlugin = (songsDir: string, quaverDirs: string[]): void => {
	if (findPluginDirs(songsDir, quaverDirs).length === 0) {
		fatalError(
			`MapTogether plugin not found in ${quaverDirs.map((dir) => path.join(dir, 'Plugins')).join(', ') || 'Quaver/Plugins'} or the Steam Workshop folder.\n` +
			`  Subscribe to it on the Steam Workshop or extract it into Quaver/Plugins, then restart.`,
		);
	}

	const pick = (): void => {
		if (IPC.isAlive()) return;
		const configPath = newestConfigPath(findPluginDirs(songsDir, quaverDirs));
		if (!configPath || configPath === IPC.getConfigPath()) return;
		IPC.setConfigPath(configPath);
		clack.log.info(`Plugin: ${path.dirname(configPath)}`);
	};
	pick();
	setInterval(pick, PLUGIN_SCAN_MS);
}

const setupInput = (): void => {
	const exit = (): void => {
		process.stdout.write('\n');
		clack.outro('Stopped.');
		process.exit(0);
	};
	process.on('SIGINT',  exit);
	process.on('SIGTERM', exit);
	try {
		if (process.stdin.isTTY) process.stdin.setRawMode(true);
	} catch { /* ignored */ }
	process.stdin.resume();
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (key: string) => {
		if (key === '\r' || key === '\n' || key === '\x03' || key === '\x1b') exit();
	});
}

const restartWith = (releaseLock: () => void) => (env: Record<string, string>): void => {
	IPC.stop();
	wsStop();
	releaseLock();
	process.stdin.removeAllListeners('data');
	process.stdin.pause();
	clack.log.info('Restarting the companion…');
	restart(env, process.argv.slice(2).filter((arg) => arg !== '--reset' && arg !== '-r'));
}

const logUnexpected = (e: unknown): void => {
	clack.log.error(`Unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
}

const main = async (): Promise<void> => {
	process.on('uncaughtException', logUnexpected);
	process.on('unhandledRejection', logUnexpected);
	removeOldVersion();
	if (await updateAndRestart()) return;

	const releaseLock = acquireLock(LOCK_PATH);
	clack.intro('MapTogether companion');

	state.songsDir = await getSongsDir(PERSIST_PATH, RESET_FLAG);
	setupInput();
	const quaverDirs = findQuaverDirs(state.songsDir);
	state.username = (quaverDirs[0] && readQuaverConfig(quaverDirs[0], 'Username')) ?? 'Player';

	clack.log.info(`Player: ${state.username}`);
	clack.log.info(`Server: ${SERVER_URL}`);
	followPlugin(state.songsDir, quaverDirs);
	clack.log.info('Waiting for Quaver + MapTogether plugin...');
	clack.log.info('Press Enter or Escape to stop.');
	process.stdout.write('\n');

	setupIpcHandler();
	initIPC();
	wsConnect(SERVER_URL);

	const gui = startGui({
		port: Number(process.env['MT_GUI_PORT']) || undefined,
		token: process.env['MT_GUI_TOKEN'],
		onRestart: restartWith(releaseLock),
	});
	clack.log.info(`Companion window: ${gui.url}`);
	if (!process.env['MT_NO_GUI'] && !gui.resumed) openInBrowser(gui.url);
}

main().catch((e: unknown) => {
	clack.log.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
});
