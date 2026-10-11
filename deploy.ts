#!/usr/bin/env bun
// Deploys MapTogether.
//   release  uploads dist/companion/ to the releases folder served by versions.php
//   server   pulls master on the server host, rebuilds the container and checks it answers
//   linux    builds the Linux companion on the server host from the deployed commit
//   site     uploads the landing page from site/
//
// Usage: bun deploy.ts [release] [server] [linux] [site]   (no argument: all)
// Needs MT_DEPLOY_HOST, MT_DEPLOY_SITE_PATH and MT_DEPLOY_SERVER_PATH, for example in a .env file.

import { $ } from 'bun';
import { unlinkSync } from 'fs';
import WebSocket from 'ws';

import { PROTOCOL_VERSION } from '@mtg-shared/protocol';

const REMOTE_HOST   = process.env['MT_DEPLOY_HOST'] ?? '';
const SITE_PATH     = process.env['MT_DEPLOY_SITE_PATH'] ?? '';
const RELEASES_PATH = `${SITE_PATH}/releases`;
const SERVER_PATH   = process.env['MT_DEPLOY_SERVER_PATH'] ?? '';
const SERVER_URL    = process.env['MT_SERVER'] ?? 'wss://qmtg.rhythmgamers.net';

const CHECK_ATTEMPTS = 10;
const CHECK_DELAY_MS = 2000;

const main = async (): Promise<void> => {
	if (!REMOTE_HOST || !SITE_PATH || !SERVER_PATH) {
		console.error('Set MT_DEPLOY_HOST, MT_DEPLOY_SITE_PATH and MT_DEPLOY_SERVER_PATH, for example in a .env file.');
		process.exit(1);
	}
	const steps = process.argv.slice(2);
	const all = steps.length === 0;

	if ((all || steps.includes('release')) && !await deployRelease()) process.exit(1);
	if ((all || steps.includes('server')) && !await deployServer()) process.exit(1);
	if ((all || steps.includes('linux')) && !await deployLinux()) process.exit(1);
	if ((all || steps.includes('site')) && !await deploySite()) process.exit(1);
	console.log('Done.');
}

const deploySite = async (): Promise<boolean> => {
	console.log(`Uploading the landing page to ${REMOTE_HOST}:${SITE_PATH}`);
	return run($`scp site/index.php ${REMOTE_HOST}:${SITE_PATH}/index.php`);
}

const deployRelease = async (): Promise<boolean> => {
	console.log(`Uploading dist/companion/ to ${REMOTE_HOST}:${RELEASES_PATH}`);
	const archive = 'dist/maptogether-deploy.tar.gz';

	const ok = await run($`tar -czf ${archive} -C dist/companion .`)
		&& await run($`scp ${archive} ${REMOTE_HOST}:/tmp/maptogether-deploy.tar.gz`)
		&& await run($`ssh ${REMOTE_HOST} ${`cd ${RELEASES_PATH} && tar -xzmf /tmp/maptogether-deploy.tar.gz && rm /tmp/maptogether-deploy.tar.gz`}`);

	try {
		unlinkSync(archive);
	} catch { /* ignored */ }
	return ok;
}

const deployServer = async (): Promise<boolean> => {
	const localHead = (await $`git rev-parse origin/master`.nothrow().text()).trim();
	console.log(`Updating the server at ${REMOTE_HOST}:${SERVER_PATH} to ${localHead.slice(0, 7)}`);

	const serverFiles = 'src/server src/shared Dockerfile docker-compose.yml bun.lock tsconfig.json';
	const script = [
		`cd ${SERVER_PATH}`,
		'before=$(git rev-parse HEAD)',
		'git pull --ff-only',
		`if git diff --quiet "$before" HEAD -- ${serverFiles}; then echo "Server code unchanged, keeping the running container."; docker compose up -d; else docker compose up -d --build; fi`,
	].join(' && ');
	const updated = await run($`ssh ${REMOTE_HOST} ${script}`);
	if (!updated) return false;

	const remoteHead = (await $`ssh ${REMOTE_HOST} ${`git -C ${SERVER_PATH} rev-parse HEAD`}`.nothrow().text()).trim();
	if (remoteHead !== localHead) {
		console.error(`Server is on ${remoteHead.slice(0, 7)}, expected ${localHead.slice(0, 7)} (push master first).`);
		return false;
	}

	for (let attempt = 1; attempt <= CHECK_ATTEMPTS; attempt++) {
		if (await checkServer()) {
			console.log(`Server at ${SERVER_URL} answers with the current protocol.`);
			return true;
		}
		await Bun.sleep(CHECK_DELAY_MS);
	}
	console.error(`Server at ${SERVER_URL} did not acknowledge an action.`);
	return false;
}

const deployLinux = async (): Promise<boolean> => {
	const { version } = await Bun.file('package.json').json() as { version: string };
	const out = `${RELEASES_PATH}/linux/v${version}`;
	console.log(`Building the Linux companion v${version} on ${REMOTE_HOST}`);

	const build = 'bun install --frozen-lockfile --production > /dev/null && bun build.ts > /dev/null && bun build --compile --target=bun-linux-x64 --outfile=/out/maptogether-companion src/companion/main.ts';
	const script = [
		`mkdir -p ${out}`,
		`git -C ${SERVER_PATH} archive HEAD | docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp -v ${out}:/out oven/bun:1 sh -c 'mkdir /tmp/app && cd /tmp/app && tar -x && ${build}'`,
	].join(' && ');
	return run($`ssh ${REMOTE_HOST} ${script}`);
}

const checkServer = (): Promise<boolean> => new Promise((resolve) => {
	const ws = new WebSocket(SERVER_URL);
	const done = (ok: boolean): void => {
		clearTimeout(timer);
		ws.removeAllListeners();
		ws.on('error', () => { /* ignored */ });
		ws.close();
		resolve(ok);
	};
	const timer = setTimeout(() => done(false), 5000);

	ws.on('open', () => {
		ws.send(JSON.stringify({
			type: 'HELLO',
			username: 'deploy-check',
			protocol: PROTOCOL_VERSION,
		}));
		ws.send(JSON.stringify({
			type: 'CREATE',
			private: true,
		}));
	});
	ws.on('message', (raw: Buffer) => {
		let msg: { type?: string } = {};
		try {
			msg = JSON.parse(raw.toString()) as { type?: string };
		} catch { /* ignored */ }
		if (msg.type === 'SESSION_CREATED') {
			ws.send(JSON.stringify({
				type: 'ACTION',
				lid: 'deploy-check',
				action: { Type: 'PlaceHitObject' },
			}));
		}
		if (msg.type === 'ACTION_ACK') done(true);
	});
	ws.on('error', () => done(false));
});

const run = async (command: ReturnType<typeof $>): Promise<boolean> => {
	const result = await command.nothrow();
	return result.exitCode === 0;
}

await main();
