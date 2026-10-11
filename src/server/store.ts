// Server-wide state: the live sessions and connected clients.
// Every other server module imports from here to read or mutate these maps.

import { WebSocket } from 'ws';

import { MATCH_TYPE } from '@mtg-shared/match';
import { SERVER_MESSAGE, ServerMessageOfType } from '@mtg-shared/server_message';
import { SessionEntry } from '@mtg-shared/session';

import { type Client, type Session, SESSION_CLIENT_STATE } from '@mtg-server/types';

export const MAX_PLAYERS = 8;

export const sessions = new Map<string, Session>();
export const clients  = new Map<string, Client>();

export const makeClientId = (): string => {
	return crypto.randomUUID();
}
export const makeSessionId = (): string => {
	return crypto.randomUUID();
}

export const makeSession = (
	client: Client,
	msg: { private?: boolean | undefined },
	resumed?: { id: string; secret: string; seq: number },
): Session => {
	return {
		id: resumed?.id ?? makeSessionId(),
		hostId: client.id,
		hostUsername: client.username,
		...(client.descriptor && { hostDescriptor: client.descriptor }),
		clients: new Map([[client.id, {
			state: SESSION_CLIENT_STATE.SYNCED,
			match: MATCH_TYPE.MATCH,
		}]]),
		nextActionSeq: (resumed?.seq ?? 0) + 1,
		private: msg.private ?? false,
		sharing: false,
		secret: resumed?.secret ?? crypto.randomUUID(),
		mapsetRequests: new Set(),
	}
}

export const send = (ws: WebSocket, msg: object): void => {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export const broadcast = (session: Session, msg: object, excludeId: string | null = null): void => {
	for (const [id] of session.clients) {
		if (id !== excludeId) {
			const client = clients.get(id);
			if (client) send(client.ws, msg);
		}
	}
}

export const broadcastSynced = (session: Session, msg: object, excludeId: string | null = null): void => {
	for (const [id, sc] of session.clients) {
		if (id === excludeId || sc.state !== 'SYNCED') continue;
		const client = clients.get(id);
		if (client) send(client.ws, msg);
	}
}

export const sessionListEntry = (session: Session): SessionEntry => {
	return {
		id: session.id,
		hostUsername: session.hostUsername,
		...(session.hostDescriptor && { descriptor: session.hostDescriptor }),
		playerCount: session.clients.size,
		maxPlayers: MAX_PLAYERS,
		private: session.private,
		sharing: session.sharing,
	};
}

export const publicSessionList = (list: Session[] = Array.from(sessions.values())): SessionEntry[] => {
	return list
		.filter(session => !session.private)
		.map(session => sessionListEntry(session))
}

export const broadcastSessionList = (): void => {
	const msg: ServerMessageOfType<typeof SERVER_MESSAGE.SESSION_LIST> = {
		type: SERVER_MESSAGE.SESSION_LIST,
		sessions: publicSessionList(),
	};
	for (const client of clients.values()) {
		if (!client.sessionId) send(client.ws, msg);
	}
}
