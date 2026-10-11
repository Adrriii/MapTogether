import { enumerate } from '@mtg-shared/enum';

export const MATCH_TYPE = {
	/** Identical content fingerprint; can jump straight to SYNCED. */
	MATCH: 'MATCH',
	/** Same mapId but different fingerprint; host must send a snapshot. */
	DIVERGED: 'DIVERGED',
	/** Same mapsetId but different difficulty; host must send a snapshot. */
	SAME_MAPSET: 'SAME_MAPSET',
	/** Unrelated map; host must send a snapshot. */
	FOREIGN: 'FOREIGN',
} as const;
export const MatchType = enumerate(MATCH_TYPE);
export type MatchType = typeof MatchType.infer;