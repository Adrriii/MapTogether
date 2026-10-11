import * as clack from '@clack/prompts';
import { execFile, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import path from 'path';
import WebSocket from 'ws';

import IPC from '@quaver-ipc/main';

import { PERSIST_PATH, VERSION } from '@mtg-companion/config';
import page from '@mtg-companion/gui.html' with { type: 'text' };
import { overwriteMapset, requestMapset } from '@mtg-companion/mapset';
import { pluginOutdated, pluginUpdatesEnabled, updatePlugin } from '@mtg-companion/plugin-update';
import { chooseSongsDir } from '@mtg-companion/songs-dir';
import { state, SYNC_STATE } from '@mtg-companion/state';
import { applyRelease, isNewer, latestRelease, updatesEnabled } from '@mtg-companion/update';

type Route = (req: Request) => Promise<Response> | Response;

type GuiOptions = {
	port?: number | undefined;
	token?: string | undefined;
	onRestart: (env: Record<string, string>) => void;
};

type UpdateReport = {
	companion: string;
	plugin?: string;
	restarting: boolean;
};

const RESTART_DELAY_MS = 300;

let TOKEN = randomBytes(16).toString('hex');
let picking = false;
let updating = false;
let server: ReturnType<typeof Bun.serve> | undefined;
let onRestart: GuiOptions['onRestart'] = () => undefined;

export const startGui = (options: GuiOptions): { url: string; resumed: boolean } => {
	TOKEN = options.token ?? TOKEN;
	onRestart = options.onRestart;
	const resumed = !!options.port && listen(options.port);
	if (!resumed) listen(0);
	return {
		url: `http://127.0.0.1:${server?.port}/?token=${TOKEN}`,
		resumed,
	};
}

export const openInBrowser = (url: string): void => {
	if (process.platform === 'win32') {
		const rundll = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'rundll32.exe');
		execFile(rundll, ['url.dll,FileProtocolHandler', url], () => undefined);
		return;
	}
	const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
		detached: true,
		stdio: 'ignore',
	});
	child.on('error', () => clack.log.info(`Open ${url} in your browser to see the companion window.`));
	child.unref();
}

const handle = (req: Request, port: number): Promise<Response> | Response => {
	if (!isLocalHost(req.headers.get('host'), port)) return new Response('Forbidden', { status: 403 });

	const url = new URL(req.url);
	if (url.pathname === '/') return servePage(url);
	if (req.headers.get('x-token') !== TOKEN) return error('forbidden', 403);

	const route = ROUTES[`${req.method} ${url.pathname}`];
	return route ? route(req) : error('not found', 404);
}

const servePage = (url: URL): Response => {
	if (url.searchParams.get('token') !== TOKEN) {
		return new Response('Open this page from the link in the MapTogether companion window.', { status: 403 });
	}
	return new Response((page as unknown as string).replace('__TOKEN__', TOKEN), {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}

const join: Route = async (req) => {
	const body = await req.json().catch(() => ({})) as { sessionId?: unknown };
	if (typeof body.sessionId !== 'string') return error('sessionId missing', 400);
	if (!IPC.isAlive()) return error('Open the MapTogether plugin in Quaver first.', 409);
	if (state.syncState !== SYNC_STATE.IDLE || state.sessionId) return error('Leave your current session first.', 409);
	void IPC.send({
		type: 'join_request',
		sessionId: body.sessionId,
	});
	return Response.json({ ok: true });
}

const download: Route = async (req) => {
	const body = await req.json().catch(() => ({})) as { sessionId?: unknown };
	if (typeof body.sessionId !== 'string') return error('sessionId missing', 400);
	if (state.download?.status === 'waiting') return error('A download is already running.', 409);
	if (!state.lastSessionList.some((s) => s.id === body.sessionId && s.sharing)) {
		return error('This host does not share their map.', 409);
	}
	requestMapset(body.sessionId);
	return Response.json({ ok: true });
}

const changeSongsDir: Route = async () => {
	if (picking) return error('A folder picker is already open.', 409);
	picking = true;
	const chosen = await chooseSongsDir(PERSIST_PATH).finally(() => {
		picking = false;
	});
	if (!chosen) return error('No Songs folder was chosen.', 400);
	state.songsDir = chosen;
	return Response.json({ ok: true });
}

const update: Route = async () => {
	if (updating) return error('Already checking for updates.', 409);
	if (state.syncState !== SYNC_STATE.IDLE || state.sessionId) return error('Leave your current session before updating.', 409);
	updating = true;
	const report = await checkUpdates().catch((): UpdateReport => ({
		companion: 'The update check failed, see the companion console.',
		restarting: false,
	}));
	updating = report.restarting;
	if (report.restarting) setTimeout(restartNow, RESTART_DELAY_MS);
	return Response.json(report);
}

const checkUpdates = async (): Promise<UpdateReport> => {
	if (!updatesEnabled()) return report('Companion updates are off in this build.');
	const release = await latestRelease();
	if (!release) return report('Could not reach the update server.');
	if (!isNewer(release.version, VERSION)) return report(`Companion ${VERSION} is up to date.`);
	if (!await applyRelease(release)) return report('The companion update failed, see the companion console.');
	return {
		companion: `Updated the companion to ${release.version}, restarting.`,
		plugin: 'The plugin updates once the companion is back.',
		restarting: true,
	};
}

const report = (companion: string): UpdateReport => ({
	companion,
	plugin: checkPlugin(),
	restarting: false,
});

const checkPlugin = (): string => {
	if (!pluginUpdatesEnabled()) return 'Plugin updates are off in this build.';
	if (!IPC.isAlive()) return 'Open the plugin in Quaver to update it too.';
	if (!pluginOutdated()) return `Plugin ${VERSION} is up to date.`;
	if (!updatePlugin()) return 'Could not update the plugin, see the companion console.';
	return `Updated the plugin to ${VERSION}. Close and reopen it in Quaver if it still shows the old version.`;
}

const restartNow = (): void => {
	const port = server?.port;
	void server?.stop(true);
	onRestart({
		MT_GUI_PORT: String(port ?? 0),
		MT_GUI_TOKEN: TOKEN,
	});
}

const ROUTES: Record<string, Route> = {
	'GET /api/state': () => Response.json(snapshot()),
	'POST /api/join': join,
	'POST /api/songs-dir': changeSongsDir,
	'POST /api/update': update,
	'POST /api/download': download,
	'POST /api/download/overwrite': () => overwriteMapset()
		? Response.json({ ok: true })
		: error('Nothing to overwrite.', 409),
};

const snapshot = () => ({
	version: VERSION,
	username: state.username,
	songsDir: state.songsDir,
	notice: state.notice,
	download: state.download ?? null,
	plugin: {
		connected: IPC.isAlive(),
		version: typeof IPC.get('pluginVersion') === 'string' ? IPC.get('pluginVersion') as string : null,
	},
	server: { connected: state.ws?.readyState === WebSocket.OPEN },
	session: {
		state: state.syncState,
		role: state.sessionRole,
		id: state.sessionId,
		map: state.descriptor ? `${state.descriptor.title} [${state.descriptor.difficultyName}]` : null,
		peers: Array.from(state.peers.values()),
	},
	lobbies: state.lastSessionList.map((s) => ({
		id: s.id,
		host: s.hostUsername,
		map: s.descriptor ? `${s.descriptor.title} [${s.descriptor.difficultyName}]` : null,
		mode: s.descriptor?.mode ?? null,
		notes: s.descriptor?.noteCount ?? null,
		players: s.playerCount,
		maxPlayers: s.maxPlayers,
		sharing: s.sharing ?? false,
	})),
});

const listen = (port: number): boolean => {
	try {
		server = Bun.serve({
			hostname: '127.0.0.1',
			port,
			fetch: (req: Request): Promise<Response> | Response => handle(req, server?.port ?? port),
		});
		return true;
	} catch {
		return false;
	}
}

const error = (message: string, status: number): Response => Response.json({ error: message }, { status });

const isLocalHost = (host: string | null, port: number): boolean =>
	host === `127.0.0.1:${port}` || host === `localhost:${port}`;
