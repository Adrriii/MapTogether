import * as clack from '@clack/prompts';

import IPC from '@quaver-ipc/main';

import { COMPANION_MESSAGE } from '@mtg-shared/companion_message';
import { SERVER_MESSAGE, ServerMessageOfType } from '@mtg-shared/server_message';

import { wsSend } from '@mtg-companion/handle_server_message';
import { clearPeerState, SESSION_ROLE, state, SYNC_STATE } from '@mtg-companion/state';

export const onConnectionLost = (): void => {
	if (!state.sessionId || !state.sessionSecret || state.syncState !== SYNC_STATE.SYNCED) return;
	state.resuming = true;
	clearPeerState();
	IPC.send({ type: 'connection_lost' });
}

export const resumeOrLose = (): void => {
	if (!state.sessionId) return;
	if (!state.resuming || !state.sessionSecret) return loseSession();

	clack.log.info(`Resuming session ${state.sessionId}…`);
	wsSend({
		type: COMPANION_MESSAGE.RESUME,
		sessionId: state.sessionId,
		secret: state.sessionSecret,
		host: state.sessionRole === SESSION_ROLE.HOST,
		seq: state.lastSeq,
		private: state.sessionPrivate,
	});
}

export const onResumed = (msg: ServerMessageOfType<typeof SERVER_MESSAGE.SESSION_RESUMED>): void => {
	state.resuming = false;
	state.sessionId = msg.sessionId;
	state.sessionRole = msg.host ? SESSION_ROLE.HOST : SESSION_ROLE.JOINER;
	state.syncState = SYNC_STATE.SYNCED;
	clack.log.success(`Session resumed${msg.host ? ' as host' : ''}.`);
	IPC.send({
		type: 'session_resumed',
		host: msg.host,
	});
}

export const onResumeFailed = (msg: ServerMessageOfType<typeof SERVER_MESSAGE.RESUME_FAILED>): void => {
	clack.log.warn(`Could not resume the session: ${msg.message}`);
	loseSession();
}

export const trackSeq = (seq: number): void => {
	state.lastSeq = Math.max(state.lastSeq, seq);
}

const loseSession = (): void => {
	state.resuming = false;
	state.syncState = SYNC_STATE.IDLE;
	state.sessionId = null;
	state.sessionRole = null;
	clearPeerState();
	IPC.send({ type: 'session_lost' });
}
