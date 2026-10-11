import * as clack from '@clack/prompts';

import { COMPANION_MESSAGE, CompanionMessage, isCompanionMessageOfType } from '@mtg-shared/companion_message';
import { formatDescriptor } from '@mtg-shared/map_descriptor';
import { MATCH_TYPE } from '@mtg-shared/match';
import { CLOSE_OUTDATED, DOWNLOAD_URL, PROTOCOL_VERSION } from '@mtg-shared/protocol';
import { SERVER_MESSAGE, type ServerMessageOfType } from '@mtg-shared/server_message';

import { classifyMatch } from '@mtg-server/classify';
import { advanceToSynced, removeFromSession, requestSnapshot } from '@mtg-server/session';
import { broadcastSessionList, clients, makeSession, MAX_PLAYERS, publicSessionList, send, sessions } from '@mtg-server/store';
import { type Client, CLIENT_STATE, SESSION_CLIENT_STATE, SessionClientState } from '@mtg-server/types';

const getSession = (client: Client) => {
	return sessions.get(client.sessionId ?? '');
}

const getSessionClient = (client: Client, state?: SessionClientState) => {
	const session = getSession(client);
	if (!session) return;

	const sessionClient = session.clients.get(client.id);
	if (!sessionClient || sessionClient.state !== state) return;

	return sessionClient
}

export const getHostedSession = (client: Client) => {
	const session = getSession(client);
	if (!session || session.hostId !== client.id) return;
	return session;
}

const getPeer = (client: Client, peerId: string) => {
	const target = clients.get(peerId);
	if (!target || target.sessionId !== getSession(client)?.id) return;
	return target;
}

export const handleHello = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.HELLO)) return;

	if (msg.protocol !== PROTOCOL_VERSION) {
		const message = (msg.protocol ?? 0) < PROTOCOL_VERSION
			? `Your MapTogether companion is outdated, download the latest at ${DOWNLOAD_URL}`
			: 'The MapTogether server is older than your companion, it will be updated soon.';
		send(client.ws, {
			type: SERVER_MESSAGE.ERROR,
			message,
		});
		client.ws.close(CLOSE_OUTDATED, message);
		return;
	}

	client.username = msg.username.slice(0, 32);

	send(client.ws, {
		type: SERVER_MESSAGE.WELCOME,
		clientId: client.id,
	});
	send(client.ws, {
		type: SERVER_MESSAGE.SESSION_LIST,
		sessions: publicSessionList(),
	});

	client.state = CLIENT_STATE.LOBBY;
}

export const handleDescriptor = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.DESCRIPTOR)) return;

	client.descriptor = msg.descriptor;
	clack.log.info(`${client.username} descriptor: ${formatDescriptor(client.descriptor)}`);

	if (!client.sessionId) return;

	const session = getSession(client);
	if (!session) return;

	const sessionClient = getSessionClient(client, SESSION_CLIENT_STATE.PENDING_ACCEPT);
	if (!sessionClient) return;

	const match = classifyMatch(session.hostDescriptor, client.descriptor);
	sessionClient.match = match;

	const host = clients.get(session.hostId);
	if (host) send(host.ws, {
		type: SERVER_MESSAGE.JOINER,
		clientId: client.id,
		username: client.username,
		descriptor: client.descriptor ?? null,
		match,
	});
}

export const handleCreate = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.CREATE)) return;

	if (client.sessionId) {
		send(client.ws, {
			type: SERVER_MESSAGE.ERROR,
			message: 'Could not create new session: Already in a session.',
		});
		return;
	}

	const session = makeSession(client, msg);
	sessions.set(session.id, session);

	client.sessionId = session.id;
	client.state     = SESSION_CLIENT_STATE.SYNCED;

	send(client.ws, {
		type: SERVER_MESSAGE.SESSION_CREATED,
		sessionId: session.id,
		secret: session.secret,
	});

	clack.log.info(`Session ${session.id} created by ${client.username} - ${formatDescriptor(client.descriptor)}`);
	broadcastSessionList();
}

export const handleJoin = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.JOIN)) return;

	if (client.sessionId) {
		send(client.ws, {
			type: SERVER_MESSAGE.ERROR,
			message: 'Already in a session.',
		});
		return;
	}

	const session = sessions.get(msg.sessionId);
	if (!session) {
		send(client.ws, {
			type: SERVER_MESSAGE.ERROR,
			message: 'Session not found.',
		});
		return;
	}

	if (session.clients.size >= MAX_PLAYERS) {
		send(client.ws, {
			type: SERVER_MESSAGE.ERROR,
			message: 'Session is full.',
		});
		return;
	}

	const match = classifyMatch(session.hostDescriptor, client.descriptor);

	session.clients.set(client.id, {
		state: SESSION_CLIENT_STATE.PENDING_ACCEPT,
		match,
	});
	client.sessionId = session.id;
	client.state = CLIENT_STATE.RECONCILING;

	const host = clients.get(session.hostId);
	if (host) {
		send(host.ws, {
			type: SERVER_MESSAGE.JOINER,
			clientId: client.id,
			username: client.username,
			descriptor: client.descriptor ?? null,
			match,
		});
	}

	clack.log.info(`${client.username} joining ${session.id} - ${match}  ${formatDescriptor(client.descriptor)}`);
}

export const handleAccept = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.ACCEPT)) return;

	const session = getHostedSession(client);
	if (!session) return;

	const target = clients.get(msg.targetId);
	if (!target) return;

	const sessionClient = session.clients.get(msg.targetId);
	if (!sessionClient || sessionClient.state !== SESSION_CLIENT_STATE.PENDING_ACCEPT) return;
	sessionClient.state = SESSION_CLIENT_STATE.RECONCILING;

	if (sessionClient.match !== MATCH_TYPE.MATCH) {
		send(target.ws, {
			type: SERVER_MESSAGE.CLASSIFICATION,
			match: sessionClient.match,
			hostDescriptor: session.hostDescriptor,
		});
		return;
	}

	requestSnapshot(session, target.id);
}

export const handleKick = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.KICK)) return;

	const session = getHostedSession(client);
	if (!session) return;

	const target = getPeer(client, msg.targetId);
	if (!target) return;

	send(target.ws, { type: SERVER_MESSAGE.KICKED });
	removeFromSession(target, session);
}

export const handleAdopt = (client: Client): void => {
	const session = getSession(client);
	if (!session) return;

	if (!getSessionClient(client, CLIENT_STATE.RECONCILING)) return;

	requestSnapshot(session, client.id);
}

export const handleCheck = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.CHECK)) return;

	const session = getHostedSession(client);
	if (!session) return;

	for (const [id, sc] of session.clients) {
		if (id === client.id || sc.buffer || sc.state !== SESSION_CLIENT_STATE.SYNCED) continue;
		const c = clients.get(id);
		if (c) send(c.ws, {
			type: SERVER_MESSAGE.CHECK,
			seq: msg.seq,
			hash: msg.hash,
		});
	}
}

export const handleResync = (client: Client): void => {
	const session = getSession(client);
	if (!session) return;

	if (!getSessionClient(client, SESSION_CLIENT_STATE.SYNCED)) return;

	requestSnapshot(session, client.id);
}

export const handleAbort = (client: Client): void => {
	const session = sessions.get(client.sessionId ?? '');
	if (session) removeFromSession(client, session);

	delete client.sessionId;
	client.state = CLIENT_STATE.LOBBY;
}

export const handleSnapshot = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.SNAPSHOT)) return;

	const session = getSession(client);
	if (!session || !msg.targetId) return;

	const target = getPeer(client, msg.targetId);
	if (!target) return;

	const sessionClient = session.clients.get(msg.targetId);
	if (!sessionClient || sessionClient.snapshotFrom !== client.id) return;
	const buffered = sessionClient.buffer ?? [];
	delete sessionClient.snapshotFrom;
	delete sessionClient.buffer;

	clack.log.info(`${client.username} sends a snapshot to ${target.username}`);
	send(target.ws, {
		type: SERVER_MESSAGE.SNAPSHOT,
		snapshot: msg.snapshot,
		seq: msg.seq,
	});
	for (const action of buffered) {
		if (action.gseq <= msg.seq) continue;
		if (action.clientId === client.id && msg.pending.includes(action.lid)) continue;
		send(target.ws, action);
	}
	advanceToSynced(session, msg.targetId, sessionClient, target);
}

export const handleAction = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.ACTION)) return;

	const session = getSession(client);
	if (!session) return;

	const sessionClient = getSessionClient(client, CLIENT_STATE.SYNCED);
	if (!sessionClient) return;

	const gseq = session.nextActionSeq++;

	const outMsg: ServerMessageOfType<typeof SERVER_MESSAGE.ACTION> = {
		type: SERVER_MESSAGE.ACTION,
		gseq,
		clientId: client.id,
		lid: msg.lid,
		action: msg.action,
	};

	send(client.ws, {
		type: SERVER_MESSAGE.ACTION_ACK,
		lid: msg.lid,
		gseq,
	});

	for (const [id, ssc] of session.clients) {
		if (id === client.id) continue;
		if (ssc.buffer) {
			ssc.buffer.push(outMsg);
			continue;
		}
		if (ssc.state !== SESSION_CLIENT_STATE.SYNCED) continue;
		const c = clients.get(id);
		if (c) send(c.ws, outMsg);
	}
}

export const handleCursor = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.CURSOR)) return;

	const session = sessions.get(client.sessionId ?? '');
	if (!session) return;

	const outMsg = {
		type: SERVER_MESSAGE.CURSOR,
		clientId: client.id,
		time: msg.time,
	};
	for (const [id, ssc] of session.clients) {
		if (ssc.state !== SESSION_CLIENT_STATE.SYNCED) continue;
		const c = clients.get(id);
		if (c) send(c.ws, outMsg);
	}
}

export const handleDebug = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.DEBUG)) return;

	if (msg.message.length > 500) {
		msg.message = msg.message.substring(0, 200) + '...';
	}
	clack.log.info(`${client.username} | DEBUG | ${msg.message}`);
}