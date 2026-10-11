import { type } from 'arktype';

import { Action } from '@mtg-shared/action';
import { MapDescriptor } from '@mtg-shared/map_descriptor';
import { MapsetFile } from '@mtg-shared/mapset';

export const COMPANION_MESSAGE = {
	HELLO: 'HELLO',
	DESCRIPTOR: 'DESCRIPTOR',
	CREATE: 'CREATE',
	JOIN: 'JOIN',
	ACCEPT: 'ACCEPT',
	KICK: 'KICK',
	ADOPT: 'ADOPT',
	ABORT: 'ABORT',
	RESYNC: 'RESYNC',
	CHECK: 'CHECK',
	SNAPSHOT: 'SNAPSHOT',
	ACTION: 'ACTION',
	CURSOR: 'CURSOR',
	DEBUG: 'DEBUG',
	SHARING: 'SHARING',
	MAPSET_REQUEST: 'MAPSET_REQUEST',
	MAPSET: 'MAPSET',
	RESUME: 'RESUME',
} as const;
export type CompanionMessageType = typeof COMPANION_MESSAGE[keyof typeof COMPANION_MESSAGE];

export const CompanionMessage = type(
	{
		type: `'${COMPANION_MESSAGE.HELLO}'`,
		username: 'string',
		'protocol?': 'number',
	})
	.or({
		type: `'${COMPANION_MESSAGE.DESCRIPTOR}'`,
		descriptor: MapDescriptor,
	})
	.or({
		type: `'${COMPANION_MESSAGE.CREATE}'`,
		'private?': 'boolean',
	})
	.or({
		type: `'${COMPANION_MESSAGE.JOIN}'`,
		sessionId: 'string',
	})
	.or({
		type: `'${COMPANION_MESSAGE.ACCEPT}'`,
		targetId: 'string',
	})
	.or({
		type: `'${COMPANION_MESSAGE.KICK}'`,
		targetId: 'string',
	})
	.or({ type: `'${COMPANION_MESSAGE.ADOPT}'` })
	.or({ type: `'${COMPANION_MESSAGE.ABORT}'` })
	.or({ type: `'${COMPANION_MESSAGE.RESYNC}'` })
	.or({
		type: `'${COMPANION_MESSAGE.CHECK}'`,
		seq: 'number',
		hash: 'string',
	})
	.or({
		type: `'${COMPANION_MESSAGE.SNAPSHOT}'`,
		'targetId?': 'string',
		snapshot: 'unknown',
		seq: 'number',
		pending: 'string[]',
	})
	.or({
		type: `'${COMPANION_MESSAGE.ACTION}'`,
		lid: 'string',
		action: Action,
	})
	.or({
		type: `'${COMPANION_MESSAGE.CURSOR}'`,
		time: 'number',
	})
	.or({
		type: `'${COMPANION_MESSAGE.DEBUG}'`,
		message: 'string',
	})
	.or({
		type: `'${COMPANION_MESSAGE.SHARING}'`,
		enabled: 'boolean',
	})
	.or({
		type: `'${COMPANION_MESSAGE.MAPSET_REQUEST}'`,
		sessionId: 'string',
	})
	.or({
		type: `'${COMPANION_MESSAGE.MAPSET}'`,
		targetId: 'string',
		'name?': 'string',
		'files?': MapsetFile.array(),
		'error?': 'string',
	})
	.or({
		type: `'${COMPANION_MESSAGE.RESUME}'`,
		sessionId: 'string',
		secret: 'string',
		host: 'boolean',
		seq: 'number',
		'private?': 'boolean',
	})
;
export type CompanionMessage = typeof CompanionMessage.infer;
export type CompanionMessageOfType<T extends CompanionMessageType> = Extract<CompanionMessage, { type: T }>;

export const isCompanionMessageOfType = <T extends CompanionMessageType>(msg: CompanionMessage, type: T): msg is CompanionMessageOfType<T> => {
	return msg.type === type;
}