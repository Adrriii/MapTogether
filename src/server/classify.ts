import { MapDescriptor } from '@mtg-shared/map_descriptor';
import { MATCH_TYPE, MatchType } from '@mtg-shared/match';


// Determines how compatible a joiner's map is with the host's map.
export const classifyMatch = (hostDesc?: MapDescriptor, joinerDesc?: MapDescriptor): MatchType => {
	if (!hostDesc || !joinerDesc) return MATCH_TYPE.FOREIGN;
	if (hostDesc.fingerprint === joinerDesc.fingerprint) return MATCH_TYPE.MATCH;

	const hSet = hostDesc.mapSetId;
	const jSet = joinerDesc.mapSetId;
	const hMap = hostDesc.mapId;
	const jMap = joinerDesc.mapId;

	if (hSet && jSet && hSet === jSet) {
		return hMap && jMap && hMap === jMap ? MATCH_TYPE.DIVERGED : MATCH_TYPE.SAME_MAPSET;
	}

	return MATCH_TYPE.FOREIGN;
}
