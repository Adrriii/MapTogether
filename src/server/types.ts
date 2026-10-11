import type { WebSocket } from 'ws';

import { MapDescriptor } from '@mtg-shared/map_descriptor';
import { MatchType } from '@mtg-shared/match';
import { SERVER_MESSAGE, ServerMessageOfType } from '@mtg-shared/server_message';


export const CLIENT_STATE = {
	CONNECTED: 'CONNECTED',
	LOBBY: 'LOBBY',
	RECONCILING: 'RECONCILING',
	SYNCED: 'SYNCED',
} as const;

export const SESSION_CLIENT_STATE = {
	PENDING_ACCEPT: 'PENDING_ACCEPT',
	RECONCILING: 'RECONCILING',
	SYNCED: 'SYNCED',
} as const;

export type ClientState = typeof CLIENT_STATE[keyof typeof CLIENT_STATE];
export type SessionClientState = typeof SESSION_CLIENT_STATE[keyof typeof SESSION_CLIENT_STATE];

export type SessionClient = {
	state: SessionClientState;
	match: MatchType;
	snapshotFrom?: string;
	buffer?: ServerMessageOfType<typeof SERVER_MESSAGE.ACTION>[];
}

export type Session = {
	id:              string;
	hostId:          string;
	hostUsername:    string;
	hostDescriptor?: MapDescriptor;
	clients:         Map<string, SessionClient>;
	nextActionSeq:   number;
	private:         boolean;
	sharing:         boolean;
	secret:          string;
	mapsetRequests:  Set<string>;
}

export type Client = {
	id:          string;
	ws:          WebSocket;
	username:    string;
	state:       ClientState;
	sessionId?:  string;
	descriptor?: MapDescriptor;
}