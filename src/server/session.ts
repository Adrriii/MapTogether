import * as clack from '@clack/prompts';

import { SERVER_MESSAGE } from '@mtg-shared/server_message';

import { broadcast, broadcastSessionList, broadcastSynced, clients, send, sessions } from '@mtg-server/store';
import { type Client, CLIENT_STATE, type Session, SESSION_CLIENT_STATE, type SessionClient } from '@mtg-server/types';

// Replays the op-log to the new client, then notifies all existing SYNCED
// peers of the newcomer (and vice versa).
export const advanceToSynced=(session: Session, clientId: string, sc: SessionClient, client: Client): void => {
	if (sc.state === SESSION_CLIENT_STATE.SYNCED) return;
	sc.state     = SESSION_CLIENT_STATE.SYNCED;
	client.state = CLIENT_STATE.SYNCED
	send(client.ws, {
		type: SERVER_MESSAGE.SYNCED,
		hostClientId: session.hostId,
		secret: session.secret,
	});
	const joinMsg = {
		type: SERVER_MESSAGE.PEER_JOINED,
		clientId: client.id,
		username: client.username,
		isHost: client.id === session.hostId,
	};
	for (const [id, ssc] of session.clients) {
		if (id === clientId || ssc.state !== SESSION_CLIENT_STATE.SYNCED) continue;
		const c = clients.get(id);
		if (!c) continue;
		send(c.ws, joinMsg);
		send(client.ws, {
			type: SERVER_MESSAGE.PEER_JOINED,
			clientId: c.id,
			username: c.username,
			isHost: c.id === session.hostId,
		});
	}
}

export const requestSnapshot = (session: Session, targetId: string): void => {
	const target = session.clients.get(targetId);
	const sourceId = targetId !== session.hostId
		? session.hostId
		: [...session.clients].find(([id, sc]) => id !== targetId && sc.state === SESSION_CLIENT_STATE.SYNCED && !sc.snapshotFrom)?.[0];
	const source = sourceId ? clients.get(sourceId) : undefined;
	if (!target || !source) {
		if (target) {
			delete target.snapshotFrom;
			delete target.buffer;
		}
		return;
	}

	target.snapshotFrom = source.id;
	target.buffer = [];
	send(source.ws, {
		type: SERVER_MESSAGE.SNAPSHOT_REQUEST,
		targetId,
	});
}

// Removes a client from the session. If the session becomes empty it is
// deleted. If the host left, the oldest remaining client is promoted.
export const removeFromSession = (client: Client, session: Session): void => {
	delete client.sessionId;
	client.state = CLIENT_STATE.LOBBY;
	leave(client, session);
	broadcastSessionList();
}

const leave = (client: Client, session: Session): void => {
	session.clients.delete(client.id);
	broadcast(session, {
		type: SERVER_MESSAGE.PEER_LEFT,
		clientId: client.id,
		username: client.username,
	});
	if (session.clients.size === 0) {
		sessions.delete(session.id);
		clack.log.info(`Session ${session.id} closed (empty).`);
		return;
	}
	if (session.hostId !== client.id) {
		rerequestSnapshots(session, client.id);
		return;
	}

	const synced = [...session.clients].filter(([, sc]) => sc.state === SESSION_CLIENT_STATE.SYNCED);
	const next = synced.find(([, sc]) => !sc.snapshotFrom) ?? synced[0];
	if (!next) {
		closeSession(session);
		return;
	}

	const [id] = next;
	const host = clients.get(id);
	session.hostId       = id;
	session.hostUsername = host?.username ?? '?';
	session.sharing      = false;
	session.mapsetRequests.clear();
	if (host?.descriptor) session.hostDescriptor = host.descriptor;
	clack.log.info(`Session ${session.id}: new host is ${session.hostUsername}`);
	broadcastSynced(session, {
		type: SERVER_MESSAGE.HOST_CHANGED,
		hostClientId: id,
	});
	rerequestSnapshots(session, client.id);
}

const rerequestSnapshots = (session: Session, leftId: string): void => {
	for (const [id, sc] of session.clients) {
		if (sc.snapshotFrom === leftId) requestSnapshot(session, id);
	}
}

const closeSession = (session: Session): void => {
	for (const [id] of session.clients) {
		const c = clients.get(id);
		if (!c) continue;
		send(c.ws, { type: SERVER_MESSAGE.KICKED });
		delete c.sessionId;
		c.state = CLIENT_STATE.LOBBY;
	}
	sessions.delete(session.id);
	clack.log.info(`Session ${session.id} closed (no synced client left).`);
}
