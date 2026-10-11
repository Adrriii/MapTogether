import { type } from 'arktype';

export const enumerate = <T extends string>(ENUM: Record<string | number | symbol, T>) => {
	return type.enumerated(...Object.values(ENUM));
}