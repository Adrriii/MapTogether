#!/usr/bin/env bun
// Dev watcher for MapTogether.
//
// Lua sources  → rebuild plugin.lua
// TS sources   → bun --watch handles companion restarts automatically
//
// Usage: bun scripts/watch.ts   (or: bun run watch)

import { type ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

const debounce = (fn: () => void, ms: number): () => void => {
	let t: ReturnType<typeof setTimeout> | undefined;
	return () => {
		clearTimeout(t);
		t = setTimeout(fn, ms);
	};
}

const log = (msg: string): void => {
	process.stdout.write(`\n[watch] ${msg}\n`);
}

// ── Lua build ─────────────────────────────────────────────────────────────────

const rebuild = (): void => {
	try {
		const result = Bun.spawnSync(['bun', 'scripts/build.ts'], {
			cwd: ROOT,
			stdio: ['inherit', 'inherit', 'inherit'],
		});
		if (result.exitCode !== 0) log('Build failed.');
	} catch {
		log('Build failed.');
	}
}

// ── Companion process (bun --watch handles TS reload) ─────────────────────────

let proc: ChildProcess | null = null;

const spawnCompanion = (): void => {
	proc = spawn('bun', ['--watch', 'src/companion/main.ts'], {
		cwd: ROOT,
		stdio: ['ignore', 'inherit', 'inherit'],
	});
	proc.on('exit', (code, signal) => {
		proc = null;
		if (!signal) log('Companion exited. Watching for changes…');
	});
}

const startCompanion = (): void => {
	if (proc) {
		proc.once('exit', () => spawnCompanion());
		proc.kill();
	} else {
		spawnCompanion();
	}
}

// ── Watchers ──────────────────────────────────────────────────────────────────

const onLuaChange = debounce(() => {
	log('Lua source changed - rebuilding plugin.lua…');
	rebuild();
}, 200);

const luaSources = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
	.map(f => path.join('src', f as string))
	.filter(f => f.endsWith('.lua'));

for (const file of luaSources) fs.watch(path.join(ROOT, file), onLuaChange);

// ── Shutdown ──────────────────────────────────────────────────────────────────

process.on('SIGINT', () => {
	if (proc) proc.kill('SIGINT');
	process.exit(0);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

log('Building…');
rebuild();
log('Starting companion (bun --watch)…');
startCompanion();
log('Watching:');
log('  Lua → ' + luaSources.join(', '));
log('  TS  → handled by bun --watch inside the companion process');
log('Ctrl+C to stop.');
