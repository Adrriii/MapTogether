import type WebSocket from 'ws';

import { MapDescriptor } from '@mtg-shared/map_descriptor';
import { SessionEntry } from '@mtg-shared/session';

export const SYNC_STATE = {
	IDLE: 'IDLE',
	SCANNING: 'SCANNING',
	SYNCED: 'SYNCED',
} as const;

export type SyncState = typeof SYNC_STATE[keyof typeof SYNC_STATE];


export const SESSION_ROLE = {
	HOST: 'host',
	JOINER: 'joiner',
} as const;
export type SessionRole = typeof SESSION_ROLE[keyof typeof SESSION_ROLE];

export const state = {
	ws: null as WebSocket | null,
	clientId: null as string | null,
	descriptor: null as MapDescriptor | null,
	sessionId: null as string | null,
	sessionRole: null as SessionRole | null,
	syncState: SYNC_STATE.IDLE as SyncState,
	lastSessionList: [] as SessionEntry[],
	lastSentCursor: -1,
	peerCursors: new Map<string, number>(),
	peers: new Map<string, { name: string; isHost: boolean }>(),
	songsDir: null as string | null,
	username: 'Player',
	scanning: false,
	scanSecret: null as string | null,
	notice: null as string | null,
	mapFile: undefined as string | undefined,
	sharing: false,
	sentSharing: undefined as boolean | undefined,
	sessionSecret: undefined as string | undefined,
	sessionPrivate: false,
	lastSeq: 0,
	resuming: false,
	download: undefined as { sessionId: string; status: 'waiting' | 'done' | 'failed' | 'exists'; message: string } | undefined,
};

export const clearPeerState = (): void => {
	state.peerCursors.clear();
	state.peers.clear();
	state.lastSentCursor = -1;
}
