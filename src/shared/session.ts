import { type } from 'arktype';

import { MapDescriptor } from '@mtg-shared/map_descriptor';

export const SessionEntry = type({
	id: 'string',
	hostUsername: 'string',
	descriptor: MapDescriptor.optional(),
	playerCount: 'number',
	maxPlayers: 'number',
	private: 'boolean',
	'sharing?': 'boolean',
});
export type SessionEntry = typeof SessionEntry.infer;