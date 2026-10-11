import type { IpcMessage } from '@quaver-ipc/main';

export const dropNull = (_key: string, value: unknown): unknown => value === null ? undefined : value;

export const unpack = (message: IpcMessage): IpcMessage => {
	if (typeof message['data'] !== 'string') return message;
	try {
		const payload: unknown = JSON.parse(message['data']);
		if (!payload || typeof payload !== 'object') return message;
		return {
			...payload,
			id: message.id,
			session: message.session,
		};
	} catch {
		return message;
	}
};
