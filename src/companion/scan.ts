import * as clack from '@clack/prompts';

import IPC from '@quaver-ipc/main';

import { COMPANION_MESSAGE } from '@mtg-shared/companion_message';

import { wsSend } from '@mtg-companion/handle_server_message';
import { scanForMarker } from '@mtg-companion/scanner';
import { state, SYNC_STATE } from '@mtg-companion/state';

const SCAN_MS = 500;

const MTIME_SLACK_MS = 2000;

const scheduleScan = (secret: string, since: number): void => {
	setTimeout(async () => {
		if (!state.scanning || state.scanSecret !== secret) return;
		const songsDir = state.songsDir;
		if (!songsDir) return;
		let result: Awaited<ReturnType<typeof scanForMarker>> = null;
		try {
			result = await scanForMarker(songsDir, secret, since);
		} catch (e) {
			clack.log.error(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		if (result) {
			state.scanning   = false;
			state.descriptor = result.descriptor;
			state.mapFile    = result.filePath;
			process.stdout.write('\n');
			clack.log.success(`Map: ${result.descriptor.title} - ${result.descriptor.difficultyName}`);
			IPC.send({
				type: 'map_found',
				descriptor: result.descriptor,
			});
			wsSend({
				type: COMPANION_MESSAGE.DESCRIPTOR,
				descriptor: result.descriptor,
			});
		} else {
			scheduleScan(secret, since);
		}
	}, SCAN_MS);
}

export const startScan = (secret: string): void => {
	if (state.scanning && state.scanSecret === secret) return;
	state.scanning  = true;
	state.scanSecret = secret;
	state.syncState = SYNC_STATE.SCANNING;
	clack.log.info(`Scanning for marker with secret ${secret} in: ${state.songsDir}`);
	scheduleScan(secret, Date.now() - MTIME_SLACK_MS);
}
