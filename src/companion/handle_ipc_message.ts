
import IPC from '@quaver-ipc/main';

import { COMPANION_MESSAGE } from '@mtg-shared/companion_message';

import { wsSend } from '@mtg-companion/handle_server_message';
import { startScan } from '@mtg-companion/scan';
import { clearPeerState, state, SYNC_STATE } from '@mtg-companion/state';

export const setupIpcHandler = (): void => {
	IPC.listeners.message.on(msg => {
		if (!msg.type) return;

		switch (msg.type) {
			case 'create_session':
				state.sessionPrivate = (msg['private'] as boolean | undefined) ?? false;
				wsSend({
					type: COMPANION_MESSAGE.CREATE,
					private: state.sessionPrivate,
				});
				break;
			case 'join_session':
				state.sessionId = msg['sessionId'] as string;
				wsSend({
					type: COMPANION_MESSAGE.JOIN,
					sessionId: state.sessionId,
				});
				break;
			case 'accept_joiner':
				wsSend({
					type: COMPANION_MESSAGE.ACCEPT,
					targetId: msg['targetId'],
				});
				break;
			case 'kick':
				wsSend({
					type: COMPANION_MESSAGE.KICK,
					targetId: msg['targetId'],
				});
				break;
			case 'adopt':
				wsSend({ type: COMPANION_MESSAGE.ADOPT });
				break;
			case 'abort':
				wsSend({ type: COMPANION_MESSAGE.ABORT });
				state.sessionId = null;
				state.sessionRole = null;
				state.syncState = SYNC_STATE.IDLE;
				state.scanning = false;
				clearPeerState();
				break;
			case 'resync':
				wsSend({ type: COMPANION_MESSAGE.RESYNC });
				break;
			case 'check':
				wsSend({
					type: COMPANION_MESSAGE.CHECK,
					seq: Number(msg['seq']) || 0,
					hash: String(msg['hash']),
				});
				break;
			case 'snapshot':
				wsSend({
					type: COMPANION_MESSAGE.SNAPSHOT,
					targetId: msg['targetId'],
					snapshot: msg['snapshot'],
					seq: Number(msg['seq']) || 0,
					pending: Array.isArray(msg['pending']) ? msg['pending'].filter((lid) => typeof lid === 'string') : [],
				});
				break;
			case 'action':
				wsSend({
					type: COMPANION_MESSAGE.ACTION,
					lid: String(msg['lid']),
					action: msg['action'],
				});
				break;
			case 'debug':
				wsSend({
					type: COMPANION_MESSAGE.DEBUG,
					message: JSON.stringify(msg.data),
				});
				break;
			case 'map_marker_ready':
				startScan(msg['secret'] as string);
				break;
		}
	});
}
