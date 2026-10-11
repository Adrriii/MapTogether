import * as clack from '@clack/prompts';
import { WebSocketServer } from 'ws';

import { onConnect } from '@mtg-server/websocket';

const PORT = Number(process.env['PORT']) || 7777;
const MAX_PAYLOAD = 32 * 1024 * 1024;

const wss = new WebSocketServer({
	port: PORT,
	maxPayload: MAX_PAYLOAD,
});
wss.on('connection', onConnect);

clack.intro('MapTogether server');
clack.log.info(`Listening on ws://localhost:${PORT}`);
clack.log.info('Press Ctrl+C to stop.');

const exit = () => {
	clack.outro('Stopped.');
	process.exit(0);
};

process.on('SIGINT', exit);
process.on('SIGTERM', exit);
