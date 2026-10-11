// Handles the full lifecycle of a single WebSocket connection: client
// registration, message dispatch, and cleanup on disconnect.

import * as clack from '@clack/prompts';
import { ArkErrors } from 'arktype';
import { WebSocket } from 'ws';

import { COMPANION_MESSAGE, CompanionMessage } from '@mtg-shared/companion_message';

import {
	handleAbort,
	handleAccept, handleAction, handleAdopt, 	handleCheck, handleCreate, handleCursor, handleDebug, handleDescriptor, handleHello, handleJoin,
	handleKick, handleResync, handleSnapshot,
} from '@mtg-server/handle_companion_message';
import { handleMapset, handleMapsetRequest, handleSharing } from '@mtg-server/handle_mapset';
import { handleResume } from '@mtg-server/resume';
import { removeFromSession } from '@mtg-server/session';
import { clients, makeClientId, sessions } from '@mtg-server/store';
import { Client, CLIENT_STATE } from '@mtg-server/types';

const HEARTBEAT_MS = 30000;

const getMessage = (client: Client, raw: Buffer | string): CompanionMessage | undefined => {
	let msg;
	try {
		msg = JSON.parse(raw.toString());
	} catch { return; }
	const result = CompanionMessage(msg);

	if (result instanceof ArkErrors) {
		result.forEach((err) => clack.log.error(`${client.username} [${err.path.join(".") || "root"}]: ${err.message}`));
		console.log('invalid msg:', JSON.stringify(msg, null, 2));
		return;
	}

	return result;;
}

export const onConnect = (ws: WebSocket): void => {
	const client: Client = {
		id: makeClientId(),
		username: 'Player',
		state: CLIENT_STATE.CONNECTED,
		ws,
	};
	clients.set(client.id, client);

	let alive = true;
	const heartbeat = setInterval(() => {
		if (!alive) {
			ws.terminate();
			return;
		}
		alive = false;
		ws.ping();
	}, HEARTBEAT_MS);
	ws.on('pong', () => {
		alive = true;
	});

	ws.on('message', (raw: Buffer | string) => {
		const msg = getMessage(client, raw);
		if (!msg) return;

		switch (msg.type) {
			case COMPANION_MESSAGE.HELLO:      handleHello(client, msg); break;
			case COMPANION_MESSAGE.DESCRIPTOR: handleDescriptor(client, msg); break;
			case COMPANION_MESSAGE.CREATE:     handleCreate(client, msg); break;
			case COMPANION_MESSAGE.JOIN:       handleJoin(client, msg); break;
			case COMPANION_MESSAGE.ACCEPT:     handleAccept(client, msg); break;
			case COMPANION_MESSAGE.KICK:       handleKick(client, msg); break;
			case COMPANION_MESSAGE.ADOPT:      handleAdopt(client); break;
			case COMPANION_MESSAGE.ABORT:      handleAbort(client); break;
			case COMPANION_MESSAGE.RESYNC:     handleResync(client); break;
			case COMPANION_MESSAGE.CHECK:      handleCheck(client, msg); break;
			case COMPANION_MESSAGE.SNAPSHOT:   handleSnapshot(client, msg); break;
			case COMPANION_MESSAGE.ACTION:     handleAction(client, msg); break;
			case COMPANION_MESSAGE.CURSOR:     handleCursor(client, msg); break;
			case COMPANION_MESSAGE.DEBUG:      handleDebug(client, msg); break;
			case COMPANION_MESSAGE.SHARING:    handleSharing(client, msg); break;
			case COMPANION_MESSAGE.MAPSET_REQUEST: handleMapsetRequest(client, msg); break;
			case COMPANION_MESSAGE.MAPSET:     handleMapset(client, msg); break;
			case COMPANION_MESSAGE.RESUME:     handleResume(client, msg); break;
		}
	});

	ws.on('close', () => {
		clearInterval(heartbeat);
		if (client.sessionId) {
			const session = sessions.get(client.sessionId);
			if (session) removeFromSession(client, session);
		}
		clients.delete(client.id);
	});
}
