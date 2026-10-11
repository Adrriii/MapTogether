import { type } from 'arktype';

import { Action } from '@mtg-shared/action';
import { MapDescriptor } from '@mtg-shared/map_descriptor';
import { MapsetFile } from '@mtg-shared/mapset';
import { MatchType } from '@mtg-shared/match';
import { SessionEntry } from '@mtg-shared/session';

export const SERVER_MESSAGE = {
	WELCOME: 'WELCOME',
	SESSION_LIST: 'SESSION_LIST',
	SESSION_CREATED: 'SESSION_CREATED',
	JOINER: 'JOINER',
	CLASSIFICATION: 'CLASSIFICATION',
	SNAPSHOT_REQUEST: 'SNAPSHOT_REQUEST',
	SNAPSHOT: 'SNAPSHOT',
	SYNCED: 'SYNCED',
	CURSOR: 'CURSOR',
	ACTION: 'ACTION',
	ACTION_ACK: 'ACTION_ACK',
	CHECK: 'CHECK',
	PEER_JOINED: 'PEER_JOINED',
	PEER_LEFT: 'PEER_LEFT',
	HOST_CHANGED: 'HOST_CHANGED',
	KICKED: 'KICKED',
	ERROR: 'ERROR',
	MAPSET_REQUEST: 'MAPSET_REQUEST',
	MAPSET: 'MAPSET',
	SESSION_RESUMED: 'SESSION_RESUMED',
	RESUME_FAILED: 'RESUME_FAILED',
} as const;
export type ServerMessageType = typeof SERVER_MESSAGE[keyof typeof SERVER_MESSAGE];

export const ServerMessage = type(
	{
		type: `'${SERVER_MESSAGE.WELCOME}'`,
		clientId: 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.SESSION_LIST}'`,
		sessions: SessionEntry.array(),
	})
	.or({
		type: `'${SERVER_MESSAGE.SESSION_CREATED}'`,
		sessionId: 'string',
		'secret?': 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.JOINER}'`,
		clientId: 'string',
		username: 'string',
		'descriptor?': MapDescriptor.or('null'),
		match: MatchType,
	})
	.or({
		type: `'${SERVER_MESSAGE.CLASSIFICATION}'`,
		match: MatchType,
		hostDescriptor: MapDescriptor,
	})
	.or({
		type: `'${SERVER_MESSAGE.SNAPSHOT_REQUEST}'`,
		targetId: 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.SNAPSHOT}'`,
		snapshot: 'unknown',
		seq: 'number',
	})
	.or({
		type: `'${SERVER_MESSAGE.SYNCED}'`,
		hostClientId: 'string',
		'secret?': 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.CURSOR}'`,
		clientId: 'string',
		time: 'number',
	})
	.or({
		type: `'${SERVER_MESSAGE.ACTION}'`,
		gseq: 'number',
		clientId: 'string',
		lid: 'string',
		action: Action,
	})
	.or({
		type: `'${SERVER_MESSAGE.CHECK}'`,
		seq: 'number',
		hash: 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.ACTION_ACK}'`,
		lid: 'string',
		gseq: 'number',
	})
	.or({
		type: `'${SERVER_MESSAGE.PEER_JOINED}'`,
		clientId: 'string',
		username: 'string',
		'isHost?': 'boolean',
	})
	.or({
		type: `'${SERVER_MESSAGE.PEER_LEFT}'`,
		clientId: 'string',
		username: 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.HOST_CHANGED}'`,
		hostClientId: 'string',
	})
	.or({ type: `'${SERVER_MESSAGE.KICKED}'` })
	.or({
		type: `'${SERVER_MESSAGE.ERROR}'`,
		message: 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.MAPSET_REQUEST}'`,
		requesterId: 'string',
		username: 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.MAPSET}'`,
		'name?': 'string',
		'files?': MapsetFile.array(),
		'error?': 'string',
	})
	.or({
		type: `'${SERVER_MESSAGE.SESSION_RESUMED}'`,
		sessionId: 'string',
		host: 'boolean',
	})
	.or({
		type: `'${SERVER_MESSAGE.RESUME_FAILED}'`,
		message: 'string',
	})
;
export type ServerMessage = typeof ServerMessage.infer;
export type ServerMessageOfType<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

export const isServerMessageOfType = <T extends ServerMessageType>(msg: ServerMessage, type: T): msg is ServerMessageOfType<T> => {
	return msg.type === type;
}