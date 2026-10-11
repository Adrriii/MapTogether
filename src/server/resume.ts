import * as clack from '@clack/prompts';

import { COMPANION_MESSAGE, CompanionMessage, CompanionMessageOfType, isCompanionMessageOfType } from '@mtg-shared/companion_message';
import { MATCH_TYPE } from '@mtg-shared/match';
import { SERVER_MESSAGE } from '@mtg-shared/server_message';

import { requestSnapshot } from '@mtg-server/session';
import { broadcastSessionList, clients, makeSession, MAX_PLAYERS, send, sessions } from '@mtg-server/store';
import { type Client, CLIENT_STATE, type Session, SESSION_CLIENT_STATE } from '@mtg-server/types';

type Resume = CompanionMessageOfType<typeof COMPANION_MESSAGE.RESUME>;

type Waiting = {
	requests: { clientId: string; msg: Resume }[];
	timer: ReturnType<typeof setTimeout>;
};

const HOST_WAIT_MS = Number(process.env['MT_RESUME_WAIT_MS']) || 20000;

const waiting = new Map<string, Waiting>();

export const handleResume = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.RESUME)) return;
	if (client.sessionId) return fail(client, 'Already in a session.');

	const session = sessions.get(msg.sessionId);
	if (session) return rejoin(session, client, msg);
	if (msg.host) return recreate(client, msg);
	wait(client, msg);
}

const recreate = (client: Client, msg: Resume): void => {
	const session = makeSession(client, { private: msg.private }, {
		id: msg.sessionId,
		secret: msg.secret,
		seq: msg.seq,
	});
	sessions.set(session.id, session);
	client.sessionId = session.id;
	client.state = CLIENT_STATE.SYNCED;
	send(client.ws, {
		type: SERVER_MESSAGE.SESSION_RESUMED,
		sessionId: session.id,
		host: true,
	});
	clack.log.info(`Session ${session.id} resumed by ${client.username}`);

	const pending = waiting.get(session.id);
	waiting.delete(session.id);
	clearTimeout(pending?.timer);
	for (const request of pending?.requests ?? []) {
		const joiner = clients.get(request.clientId);
		if (joiner && !joiner.sessionId) rejoin(session, joiner, request.msg);
	}
	broadcastSessionList();
}

const rejoin = (session: Session, client: Client, msg: Resume): void => {
	if (msg.secret !== session.secret) return fail(client, 'The session could not be resumed.');
	if (session.clients.size >= MAX_PLAYERS) return fail(client, 'The session is full.');

	session.clients.set(client.id, {
		state: SESSION_CLIENT_STATE.RECONCILING,
		match: MATCH_TYPE.MATCH,
	});
	client.sessionId = session.id;
	client.state = CLIENT_STATE.RECONCILING;
	send(client.ws, {
		type: SERVER_MESSAGE.SESSION_RESUMED,
		sessionId: session.id,
		host: false,
	});
	clack.log.info(`${client.username} resumed session ${session.id}`);
	requestSnapshot(session, client.id);
}

const wait = (client: Client, msg: Resume): void => {
	const entry = waiting.get(msg.sessionId) ?? {
		requests: [],
		timer: setTimeout(() => promote(msg.sessionId), HOST_WAIT_MS),
	};
	entry.requests.push({
		clientId: client.id,
		msg,
	});
	waiting.set(msg.sessionId, entry);
}

const promote = (sessionId: string): void => {
	const entry = waiting.get(sessionId);
	waiting.delete(sessionId);
	if (!entry || sessions.has(sessionId)) return;

	const live = entry.requests.filter((request) => {
		const c = clients.get(request.clientId);
		return c && !c.sessionId;
	});
	const first = live[0];
	const host = first && clients.get(first.clientId);
	if (!first || !host) return;

	recreate(host, {
		...first.msg,
		host: true,
	});
	const session = sessions.get(sessionId);
	if (!session) return;
	for (const request of live.slice(1)) {
		const joiner = clients.get(request.clientId);
		if (joiner && !joiner.sessionId) rejoin(session, joiner, request.msg);
	}
}

const fail = (client: Client, message: string): void => {
	send(client.ws, {
		type: SERVER_MESSAGE.RESUME_FAILED,
		message,
	});
}
