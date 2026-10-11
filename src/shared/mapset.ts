import { type } from 'arktype';

export const MapsetFile = type({
	name: 'string',
	data: 'string',
});
export type MapsetFile = typeof MapsetFile.infer;
