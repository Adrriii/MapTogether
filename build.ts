#!/usr/bin/env bun
// Lua bundler - resolves `-- @import <file>` directives recursively.
// Usage: bun build.ts

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const bundle = (srcPath: string): string => {
	const src = fs.readFileSync(srcPath, 'utf8');
	const dir = path.dirname(srcPath);
	return src.replace(/^-- @import (.+)$/gm, (_, rel: string) => {
		const abs = path.resolve(dir, rel.trim());
		return bundle(abs);
	});
}

const srcFile = path.join(__dirname, 'src', 'plugin', 'main.lua');
const outFile = process.argv[2] ?? path.join(__dirname, 'plugin.lua');

fs.writeFileSync(outFile, bundle(srcFile));
console.log(`built  ${path.relative(__dirname, outFile)}  (from src/plugin/main.lua + src/quaver_ipc/main.lua)`);
