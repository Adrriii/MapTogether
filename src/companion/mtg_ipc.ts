import * as clack from '@clack/prompts';

import IPC from '@quaver-ipc/main';

import { COMPANION_MESSAGE } from '@mtg-shared/companion_message';

import { VERSION } from '@mtg-companion/config';
import { wsSend } from '@mtg-companion/handle_server_message';
import { refreshPlugin } from '@mtg-companion/plugin-update';
import { clearPeerState, SESSION_ROLE, state, SYNC_STATE } from '@mtg-companion/state';

const INSTANCE = `${process.pid}-${Date.now()}`;

const broadcastCursor = () => {
	if (state.syncState !== SYNC_STATE.SYNCED) return;

	const cursor = Number(IPC.get('cursor'));

	if (isNaN(cursor)) return;
	if (cursor === state.lastSentCursor) return;

	wsSend({
		type: COMPANION_MESSAGE.CURSOR,
		time: cursor,
	});
	state.lastSentCursor = cursor;
}

const syncSharing = () => {
	state.sharing = String(IPC.get('sharing')) === 'true';
	const hosting = state.sessionRole === SESSION_ROLE.HOST && state.syncState === SYNC_STATE.SYNCED;
	if (!hosting) {
		state.sentSharing = undefined;
		return;
	}
	if (state.sentSharing === state.sharing) return;
	wsSend({
		type: COMPANION_MESSAGE.SHARING,
		enabled: state.sharing,
	});
	state.sentSharing = state.sharing;
}

const updateFields = () => {
	IPC.set('syncState', state.syncState);
	IPC.set('username', state.username);
	IPC.set('companionVersion', VERSION);
	IPC.set('companionInstance', INSTANCE);
	IPC.set('sessions', state.lastSessionList);
	IPC.set('notice', state.notice ?? '');

	IPC.set('peers', Array.from(state.peerCursors, ([clientId, time]) => ({
		clientId,
		time,
	})));
}

const displayTick = () => {
	if (!IPC.isAlive()) {
		process.stdout.write('\r  Waiting for plugin...'.padEnd(60));
		return;
	}
	const cursor  = IPC.get('cursor');
	const youStr  = cursor != null ? `[You: ${cursor}ms]` : '[You: --]';
	const pongAge = IPC.timeSinceLastPong() > 0 ? `${IPC.timeSinceLastPong()}ms ago` : '--';
	process.stdout.write(
		`\r  ${youStr}`.padEnd(22) +
		`  ping ${pongAge}`.padEnd(20) +
		`  sync:${state.syncState}`.padEnd(22),
	);
};

export const initIPC = () => {
	IPC.listeners.attach.on(() => {
		process.stdout.write('\n');
		clack.log.success('Plugin connected.');
	});

	IPC.listeners.detach.on(() => {
		process.stdout.write('\n');
		clack.log.warn('Plugin disconnected.');
		if (state.syncState !== SYNC_STATE.IDLE) {
			wsSend({ type: COMPANION_MESSAGE.ABORT });
		}
		state.syncState = SYNC_STATE.IDLE;
		state.sessionId = null;
		state.sessionRole = null;
		clearPeerState();
		state.scanning = false;
		state.descriptor = null;
	});

	IPC.listeners.tick.on(() => {
		refreshPlugin();
		broadcastCursor();
		syncSharing();
		updateFields();
		displayTick();
	});

	// IPC.listeners.configRead.on(() => clack.log.info('CONFIG READ'));
	// IPC.listeners.configWrite.on(() => clack.log.info('CONFIG WRITE'));
	// IPC.listeners.configConflict.on(() => clack.log.warn('CONFIG CONFLICT'));
	IPC.listeners.configReadError.on((e) => clack.log.error('CONFIG READ ERROR: ' + e));
};