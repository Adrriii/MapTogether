import { expect, test } from 'bun:test';
import { WebSocket } from 'ws';

import {
	handleAbort, handleAccept, handleAction, handleAdopt, handleCreate, handleJoin, handleResync, handleSnapshot, handleStats,
} from '@mtg-server/handle_companion_message';
import { removeFromSession } from '@mtg-server/session';
import { clients, sessions } from '@mtg-server/store';
import { type Client, CLIENT_STATE } from '@mtg-server/types';

type Sent = { type: string; [key: string]: unknown };

const makeClient = (username: string): Client & { sent: Sent[] } => {
	const sent: Sent[] = [];
	const ws = { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data) as Sent) } as unknown as WebSocket;
	const client = { id: crypto.randomUUID(), ws, username, state: CLIENT_STATE.LOBBY, sent };
	clients.set(client.id, client);
	return client;
};

const action = (client: Client, lid: string) => handleAction(client, { type: 'ACTION', lid, action: { Type: 'PlaceHitObject' } });

const snapshot = (source: Client, target: Client, seq: number, pending: string[] = []) =>
	handleSnapshot(source, { type: 'SNAPSHOT', targetId: target.id, snapshot: {}, seq, pending });

const join = (host: Client, joiner: Client): void => {
	handleJoin(joiner, { type: 'JOIN', sessionId: host.sessionId ?? '' });
	handleAccept(host, { type: 'ACCEPT', targetId: joiner.id });
	handleAdopt(joiner);
	snapshot(host, joiner, 0);
};

const after = (client: { sent: Sent[] }, type: string): Sent[] => {
	const index = client.sent.findIndex((m) => m.type === type);
	return client.sent.slice(index);
};

test('a joiner gets the snapshot, then only the actions it does not contain', () => {
	const host = makeClient('host');
	const peer = makeClient('peer');
	const joiner = makeClient('joiner');
	handleCreate(host, { type: 'CREATE' });
	join(host, peer);

	handleJoin(joiner, { type: 'JOIN', sessionId: host.sessionId ?? '' });
	handleAccept(host, { type: 'ACCEPT', targetId: joiner.id });
	handleAdopt(joiner);

	action(peer, 'p1');
	action(host, 'h1');
	action(host, 'h2');
	action(peer, 'p2');
	const seqs = host.sent.filter((m) => m.type === 'ACTION_ACK' || m.type === 'ACTION').map((m) => m['gseq']);
	expect(seqs).toEqual([1, 2, 3, 4]);
	expect(joiner.sent.some((m) => m.type === 'ACTION')).toBe(false);

	snapshot(host, joiner, 2, ['h2']);

	const received = after(joiner, 'SNAPSHOT').map((m) => m.type === 'ACTION' ? `ACTION:${m['lid']}` : m.type);
	expect(received.slice(0, 3)).toEqual(['SNAPSHOT', 'ACTION:p2', 'SYNCED']);
	sessions.clear();
});

test('a resyncing peer is re-requested from another source when its source leaves', () => {
	const host = makeClient('host');
	const a = makeClient('a');
	const b = makeClient('b');
	handleCreate(host, { type: 'CREATE' });
	join(host, a);
	join(host, b);

	handleResync(a);
	expect(host.sent.at(-1)).toMatchObject({ type: 'SNAPSHOT_REQUEST', targetId: a.id });

	const session = sessions.get(host.sessionId ?? '');
	expect(session).toBeDefined();
	if (!session) return;
	removeFromSession(host, session);

	expect(session.hostId).toBe(b.id);
	expect(b.sent.some((m) => m.type === 'SNAPSHOT_REQUEST' && m['targetId'] === a.id)).toBe(true);
	action(b, 'b1');
	expect(a.sent.some((m) => m.type === 'ACTION')).toBe(false);
	snapshot(b, a, 1, []);
	expect(a.sent.at(-1)?.type).toBe('SNAPSHOT');
	sessions.clear();
});

test('a session closed by its last player leaving disappears from the lobby lists', () => {
	const host = makeClient('host');
	const lobby = makeClient('lobby');
	handleCreate(host, { type: 'CREATE' });
	expect(lobby.sent.at(-1)).toMatchObject({ type: 'SESSION_LIST', sessions: [{ hostUsername: 'host' }] });

	handleAbort(host);

	expect(lobby.sent.at(-1)).toMatchObject({ type: 'SESSION_LIST', sessions: [] });
	expect(host.sent.at(-1)).toMatchObject({ type: 'SESSION_LIST', sessions: [] });
	sessions.clear();
});

test('stats count every live session and its players, private ones included', () => {
	const host = makeClient('host');
	const peer = makeClient('peer');
	const solo = makeClient('solo');
	const visitor = makeClient('visitor');
	handleCreate(host, { type: 'CREATE' });
	join(host, peer);
	handleCreate(solo, { type: 'CREATE', private: true });

	handleStats(visitor);

	expect(visitor.sent.at(-1)).toEqual({ type: 'STATS', sessions: 2, players: 3 });
	sessions.clear();
});
