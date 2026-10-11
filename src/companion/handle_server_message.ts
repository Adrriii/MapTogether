import * as clack from '@clack/prompts';
import { ArkErrors } from 'arktype';
import WebSocket from 'ws';

import IPC from '@quaver-ipc/main';

import { COMPANION_MESSAGE } from '@mtg-shared/companion_message';
import { CLOSE_OUTDATED, PROTOCOL_VERSION } from '@mtg-shared/protocol';
import { SERVER_MESSAGE, ServerMessage } from '@mtg-shared/server_message';

import { receiveMapset, sendMapset } from '@mtg-companion/mapset';
import { onConnectionLost, onResumed, onResumeFailed, resumeOrLose, trackSeq } from '@mtg-companion/resume';
import { clearPeerState, SESSION_ROLE, state, SYNC_STATE } from '@mtg-companion/state';
import { installUpdate } from '@mtg-companion/update';

const SERVER_SILENCE_MS = 75000;

let stopped = false;

export const wsStop = (): void => {
	stopped = true;
	state.ws?.close();
}

export const wsSend = (msg: object): void => {
	if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

const handleServerMessage = (msg: ServerMessage): void => {
	clack.log.info(`SERVER MESSAGE: ${msg.type}`);
	switch (msg.type) {
		case SERVER_MESSAGE.WELCOME:
			state.clientId = msg.clientId;
			break;
		case SERVER_MESSAGE.SESSION_LIST:
			state.lastSessionList = msg.sessions ?? [];
			break;
		case SERVER_MESSAGE.SESSION_CREATED:
			state.sessionSecret = msg.secret;
			state.lastSeq     = 0;
			state.sessionId   = msg.sessionId;
			state.sessionRole = SESSION_ROLE.HOST;
			state.syncState   = SYNC_STATE.SYNCED;
			IPC.send({
				type: 'session_created',
				sessionId: msg.sessionId,
			});
			clack.log.success(`Session created: ${msg.sessionId}`);
			break;
		case SERVER_MESSAGE.JOINER:
			IPC.send({
				type: SESSION_ROLE.JOINER,
				clientId: msg.clientId,
				username: msg.username,
				descriptor: msg.descriptor,
				match: msg.match,
			});
			break;
		case SERVER_MESSAGE.CLASSIFICATION:
			IPC.send({
				type: 'classification',
				match: msg.match,
				hostDescriptor: msg.hostDescriptor,
			});
			state.syncState = SYNC_STATE.SYNCED;
			break;
		case SERVER_MESSAGE.SNAPSHOT_REQUEST:
			clack.log.info(`Server has requested a snapshot for ${msg.targetId}`);
			IPC.send({
				type: 'snapshot_request',
				targetId: msg.targetId,
			});
			break;
		case SERVER_MESSAGE.SNAPSHOT:
			trackSeq(msg.seq);
			IPC.send({
				type: 'snapshot',
				snapshot: msg.snapshot,
				seq: msg.seq,
			});
			break;
		case SERVER_MESSAGE.SYNCED:
			state.sessionSecret = msg.secret ?? state.sessionSecret;
			state.syncState = SYNC_STATE.SYNCED;
			IPC.send({
				type: 'synced',
				hostClientId: msg.hostClientId,
			});
			break;
		case SERVER_MESSAGE.CURSOR:
			if (msg.clientId !== state.clientId) state.peerCursors.set(msg.clientId, Math.floor(msg.time));
			break;
		case SERVER_MESSAGE.ACTION:
			trackSeq(msg.gseq);
			if (msg.clientId === state.clientId) break;
			IPC.send({
				type: 'action',
				gseq: msg.gseq,
				clientId: msg.clientId,
				action: msg.action,
			});
			break;
		case SERVER_MESSAGE.CHECK:
			IPC.send({
				type: 'check',
				seq: msg.seq,
				hash: msg.hash,
			});
			break;
		case SERVER_MESSAGE.ACTION_ACK:
			trackSeq(msg.gseq);
			IPC.send({
				type: 'action_ack',
				lid: msg.lid,
				gseq: msg.gseq,
			});
			break;
		case SERVER_MESSAGE.PEER_JOINED:
			state.peers.set(msg.clientId, {
				name: msg.username,
				isHost: msg.isHost ?? false,
			});
			IPC.send({
				type: 'peer_joined',
				clientId: msg.clientId,
				username: msg.username,
				isHost: msg.isHost,
			});
			break;
		case SERVER_MESSAGE.PEER_LEFT:
			state.peerCursors.delete(msg.clientId);
			state.peers.delete(msg.clientId);
			IPC.send({
				type: 'peer_left',
				clientId: msg.clientId,
				username: msg.username,
			});
			break;
		case SERVER_MESSAGE.HOST_CHANGED:
			if (msg.hostClientId === state.clientId) state.sessionRole = SESSION_ROLE.HOST;
			state.peers.forEach((peer, id) => peer.isHost = id === msg.hostClientId);
			IPC.send({
				type: 'host_changed',
				hostClientId: msg.hostClientId,
				youAreHost: msg.hostClientId === state.clientId,
			});
			break;
		case SERVER_MESSAGE.KICKED:
			clearPeerState();
			IPC.send({ type: 'kicked' });
			state.sessionId = null;
			state.sessionRole = null;
			state.syncState = SYNC_STATE.IDLE;
			break;
		case SERVER_MESSAGE.MAPSET_REQUEST:
			sendMapset(msg);
			break;
		case SERVER_MESSAGE.MAPSET:
			receiveMapset(msg);
			break;
		case SERVER_MESSAGE.SESSION_RESUMED:
			onResumed(msg);
			break;
		case SERVER_MESSAGE.RESUME_FAILED:
			onResumeFailed(msg);
			break;
		case SERVER_MESSAGE.STATS:
			break;
		case SERVER_MESSAGE.ERROR:
			clack.log.warn(`Server: ${msg.message}`);
			IPC.send({
				type: 'server_error',
				message: msg.message,
			});
			break;
	}
}

const onWsOpen = (): void => {
	wsSend({
		type: COMPANION_MESSAGE.HELLO,
		username: state.username,
		protocol: PROTOCOL_VERSION,
	});

	if (state.descriptor) wsSend({
		type: COMPANION_MESSAGE.DESCRIPTOR,
		descriptor: state.descriptor,
	});

	resumeOrLose();
}

const getMessage = (raw: Buffer | string): ServerMessage | undefined => {
	let msg;
	try {
		msg = JSON.parse(raw.toString());
	} catch { return; }
	const result = ServerMessage(msg);

	if (result instanceof ArkErrors) {
		result.forEach((err) => clack.log.error(`[${err.path.join(".") || "root"}]: ${err.message}`));
		return;
	}

	return result;;
}

export const wsConnect = (serverUrl: string): void => {
	const ws = new WebSocket(serverUrl);
	state.ws = ws;

	let silence: ReturnType<typeof setTimeout> | undefined;
	const expectHeartbeat = (): void => {
		clearTimeout(silence);
		silence = setTimeout(() => ws.terminate(), SERVER_SILENCE_MS);
	};
	ws.on('open', expectHeartbeat);
	ws.on('ping', expectHeartbeat);
	ws.on('message', expectHeartbeat);

	ws.on('open', () => {
		clack.log.info(`Server connected: ${serverUrl}`);
		onWsOpen();
	});

	ws.on('message', (raw: Buffer | string) => {
		const msg = getMessage(raw);
		if (!msg) return;

		handleServerMessage(msg);
	});

	ws.on('close', (code: number, reason: Buffer) => {
		clearTimeout(silence);
		if (stopped) return;
		if (code === CLOSE_OUTDATED) {
			state.notice = reason.toString();
			state.ws = null;
			clack.log.error(state.notice);
			void installUpdate().then((version) => {
				if (!version) return;
				state.notice = `The companion was updated to ${version}. Restart it to reconnect.`;
				clack.log.success(state.notice);
			});
			return;
		}
		clack.log.warn('Server disconnected. Reconnecting in 3s…');
		state.ws = null;
		onConnectionLost();
		setTimeout(() => wsConnect(serverUrl), 3000);
	});

	ws.on('error', () => { /* close event will follow */ });
}
