import * as clack from '@clack/prompts';

import { COMPANION_MESSAGE, CompanionMessage, isCompanionMessageOfType } from '@mtg-shared/companion_message';
import { SERVER_MESSAGE } from '@mtg-shared/server_message';

import { getHostedSession } from '@mtg-server/handle_companion_message';
import { broadcastSessionList, clients, send, sessions } from '@mtg-server/store';
import { type Client } from '@mtg-server/types';

export const handleSharing = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.SHARING)) return;

	const session = getHostedSession(client);
	if (!session || session.sharing === msg.enabled) return;
	session.sharing = msg.enabled;
	if (!msg.enabled) session.mapsetRequests.clear();
	broadcastSessionList();
}

export const handleMapsetRequest = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.MAPSET_REQUEST)) return;

	const session = sessions.get(msg.sessionId);
	const host = session && clients.get(session.hostId);
	if (!session || !host || !session.sharing) {
		send(client.ws, {
			type: SERVER_MESSAGE.MAPSET,
			error: 'This host does not share their map.',
		});
		return;
	}
	session.mapsetRequests.add(client.id);
	send(host.ws, {
		type: SERVER_MESSAGE.MAPSET_REQUEST,
		requesterId: client.id,
		username: client.username,
	});
}

export const handleMapset = (client: Client, msg: CompanionMessage): void => {
	if (!isCompanionMessageOfType(msg, COMPANION_MESSAGE.MAPSET)) return;

	const session = getHostedSession(client);
	const target = clients.get(msg.targetId);
	if (!session || !target || !session.mapsetRequests.delete(msg.targetId)) return;
	send(target.ws, {
		type: SERVER_MESSAGE.MAPSET,
		...(msg.name !== undefined && { name: msg.name }),
		...(msg.files !== undefined && { files: msg.files }),
		...(msg.error !== undefined && { error: msg.error }),
	});
	clack.log.info(`${client.username} shared their map with ${target.username}`);
}
