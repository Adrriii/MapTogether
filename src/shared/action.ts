import { type } from 'arktype';

export const Action = type({
	Type: 'string | number',
	'[string]': 'unknown',
});
export type Action = typeof Action.infer;