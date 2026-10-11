import { type } from 'arktype';

export const MapDescriptor = type({
	title: 'string',
	artist: 'string',
	creator: 'string',
	difficultyName: 'string',
	mapId: 'number',
	mapSetId: 'number',
	mode: 'string',
	fingerprint: 'string',
	noteCount: 'number',
	mapLenMs: 'number',
	bpm: 'number',
});
export type MapDescriptor = typeof MapDescriptor.infer;

export const formatDescriptor = (descriptor?: MapDescriptor): string => {
	if (!descriptor) return '(no descriptor)';
	return `"${descriptor.title}" [${descriptor.difficultyName}] ${descriptor.mode} ${descriptor.noteCount}n ${descriptor.mapId ? `#${descriptor.mapId}` : 'local'}`;
};