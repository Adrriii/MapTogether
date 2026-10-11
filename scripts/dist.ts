#!/usr/bin/env bun
// Distribution build script.
// Outputs to dist/:
//   dist/MapTogether/                plugin.lua, settings.ini and the workshop/ files, mirrored to ../MapTogether for publishing
//   dist/companion/<platform>/<ver>/ per-platform executables
//
// Usage: bun scripts/dist.ts  (or: bun run dist)

import { execSync } from 'child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createInterface } from 'readline/promises';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PUBLISH_DIR = join(ROOT, '..', 'MapTogether');
const WORKSHOP_DIR = join(ROOT, 'workshop');
const WORKSHOP_ID_FILE = 'steam_workshop_id.txt';
const WORKSHOP_PREVIEW_FILE = 'steam_workshop_preview.png';

// ── Target platforms ─────────────────────────────────────────────────────────

type PlatformTarget = {
	bunTarget:  string;
	outputName: string;
};

const TARGETS: Record<string, PlatformTarget> = {
	windows: {
		bunTarget: 'bun-windows-x64',
		outputName: 'maptogether-companion.exe',
	},
	// linux: {
	//   bunTarget:  'bun-linux-x64',
	//   outputName: 'maptogether-companion',
	// },
	// macos: {
	//   bunTarget:  'bun-darwin-arm64',
	//   outputName: 'maptogether-companion',
	// },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const run = (cmd: string, opts: { cwd?: string } = {}): void => {
	execSync(cmd, {
		stdio: 'inherit',
		cwd: ROOT,
		...opts,
	});
};

// ── Version management ────────────────────────────────────────────────────────

type BumpResult = {
	tag:    string;
	bumped: boolean;
};

const bumpVersion = async (): Promise<BumpResult> => {
	const pkgPath = join(ROOT, 'package.json');
	const pkg     = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
	const [major, minor, patch] = pkg.version.split('.').map(Number) as [number, number, number];

	console.log(`\nCurrent version: v${pkg.version}`);
	console.log(`  1) patch  →  v${major}.${minor}.${patch + 1}`);
	console.log(`  2) minor  →  v${major}.${minor + 1}.0`);
	console.log(`  3) major  →  v${major + 1}.0.0`);
	console.log(`  0) skip   →  keep v${pkg.version}`);
	console.log('');

	const rl     = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const choice = (await rl.question('Select bump type [1]: ')).trim() || '1';
	rl.close();

	if (choice === '0') {
		console.log(`\nKeeping v${pkg.version}`);
		return {
			tag: `v${pkg.version}`,
			bumped: false,
		};
	}

	let next: string;
	switch (choice) {
		case '1': next = `${major}.${minor}.${patch + 1}`; break;
		case '2': next = `${major}.${minor + 1}.0`;        break;
		case '3': next = `${major + 1}.0.0`;               break;
		default:  console.error('Invalid choice.'); process.exit(1);
	}

	const companionConfig = join(ROOT, 'src', 'companion', 'config.ts');
	const luaConfig       = join(ROOT, 'src', 'plugin', 'config.lua');

	pkg.version = next;
	writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
	writeFileSync(companionConfig, readFileSync(companionConfig, 'utf8').replace(/VERSION\s*=\s*'v[^']*'/g, `VERSION = 'v${next}'`), 'utf8');
	writeFileSync(luaConfig, readFileSync(luaConfig, 'utf8').replace(/version\s*=\s*"v[^"]*"/g, `version = "v${next}"`), 'utf8');

	console.log(`\nVersion bumped to v${next}`);
	return {
		tag: `v${next}`,
		bumped: true,
	};
}

// ── Build steps ───────────────────────────────────────────────────────────────

const buildPlugin = (): void => {
	console.log('\nBuilding Lua plugin...');
	run('bun scripts/build.ts');

	const dir = join(DIST, 'MapTogether');
	mkdirSync(dir, { recursive: true });
	copyFileSync(join(ROOT, 'plugin.lua'),    join(dir, 'plugin.lua'));
	copyFileSync(join(ROOT, 'settings.ini'),  join(dir, 'settings.ini'));
	writeFileSync(join(dir, 'settings.ini'),
		readFileSync(join(dir, 'settings.ini'), 'utf8').replace(/-dev\b/g, ''), 'utf8');

	const publishedId = join(PUBLISH_DIR, WORKSHOP_ID_FILE);
	if (existsSync(publishedId)) copyFileSync(publishedId, join(WORKSHOP_DIR, WORKSHOP_ID_FILE));
	for (const file of [WORKSHOP_ID_FILE, WORKSHOP_PREVIEW_FILE]) {
		if (existsSync(join(WORKSHOP_DIR, file))) copyFileSync(join(WORKSHOP_DIR, file), join(dir, file));
	}
	console.log('  -> dist/MapTogether/');

	try {
		rmSync(PUBLISH_DIR, {
			recursive: true,
			force: true,
		});
		cpSync(dir, PUBLISH_DIR, { recursive: true });
	} catch (e) {
		console.error(`Error: could not refresh ${PUBLISH_DIR} - ${(e as Error).message}`);
		process.exit(1);
	}
	console.log(`  -> ${PUBLISH_DIR}`);
}

const buildCompanion = (tag: string, platform: string, { bunTarget, outputName }: PlatformTarget): void => {
	console.log(`\nBuilding companion [${platform}]...`);

	const outDir  = join(DIST, 'companion', platform, tag);
	const exePath = join(outDir, outputName);

	mkdirSync(outDir, { recursive: true });

	const icon = platform === 'windows' ? ' --windows-icon=src/companion/icon.ico' : '';
	run(`bun build --compile --target=${bunTarget}${icon} --outfile="${exePath}" src/companion/main.ts`);

	console.log(`  -> dist/companion/${platform}/${tag}/${outputName}`);
}

// ── Git commit & push ─────────────────────────────────────────────────────────

const commitAndPush = (tag: string): void => {
	console.log('\nCommitting version bump...');
	run(`git add .`);
	run(`git commit -m "bump version to ${tag}"`);
	run(`git push`);
	console.log(`  -> committed and pushed ${tag}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const { tag, bumped } = await bumpVersion();

try {
	rmSync(DIST, {
		recursive: true,
		force: true,
	});
} catch (e) {
	const err = e as NodeJS.ErrnoException;
	if (err.code === 'EBUSY') {
		console.error('Error: dist/ is locked - close maptogether-companion.exe and try again.');
		process.exit(1);
	}
	throw e;
}

buildPlugin();

for (const [platform, config] of Object.entries(TARGETS)) {
	buildCompanion(tag, platform, config);
}

const companionDir = join(DIST, 'companion');
mkdirSync(companionDir, { recursive: true });
copyFileSync(join(ROOT, 'site', 'versions.php'), join(companionDir, 'versions.php'));
console.log(`  -> dist/companion/versions.php`);

if (bumped) commitAndPush(tag);

console.log(`\nDone! ${tag} distribution files in dist/`);
