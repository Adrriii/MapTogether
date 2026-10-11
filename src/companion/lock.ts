import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const LOCK_STALE_MS   = 5000;
const EXIT_WAIT_MS    = 3000;
const COMPANION_NAMES = new Set(['node', 'node.exe', 'companion', 'companion.exe', 'bun', 'bun.exe']);

const writeLock = (lockPath: string): void => {
	fs.writeFileSync(lockPath, `${process.pid}:${Date.now()}`, 'utf8');
}

const isPidRunning = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch { return false; }
}

const isCompanionPid = (pid: number): boolean => {
	try {
		let name: string;
		if (process.platform === 'win32') {
			const tasklist = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tasklist.exe');
			const out = execSync(`"${tasklist}" /FI "PID eq ${pid}" /FO CSV /NH`, {
				encoding: 'utf8',
				timeout: 2000,
			});
			name = out.trim().split(',')[0]?.replace(/"/g, '').toLowerCase() ?? '';
		} else {
			name = execSync(`ps -p ${pid} -o comm=`, {
				encoding: 'utf8',
				timeout: 2000,
			}).trim().toLowerCase();
		}
		return COMPANION_NAMES.has(name) || name.includes('maptogether');
	} catch {
		return false;
	}
}

const handleAlivePid = (pid: number, age: number): void => {
	if (pid === process.pid) return;
	if (age >= LOCK_STALE_MS && !isCompanionPid(pid)) {
		console.warn(`stale lock for PID ${pid} - process is not a companion, skipping kill.`);
		return;
	}
	console.warn(`closing the companion that was already running (PID ${pid}).`);
	try {
		process.kill(pid, 'SIGTERM');
	} catch { /* ignored */ }
	const deadline = Date.now() + EXIT_WAIT_MS;
	while (isPidRunning(pid) && Date.now() < deadline) Bun.sleepSync(100);
}

export const acquireLock = (lockPath: string): () => void => {
	try {
		const raw = fs.readFileSync(lockPath, 'utf8').trim();
		const [pidStr, tsStr] = raw.split(':');
		const pid = parseInt(pidStr ?? '', 10);
		const ts  = parseInt(tsStr  ?? '', 10);
		const age = Date.now() - (isNaN(ts) ? 0 : ts);
		if (pid && isPidRunning(pid)) handleAlivePid(pid, age);
	} catch { /* no lock file */ }
	writeLock(lockPath);
	const refresh = setInterval(() => writeLock(lockPath), 1000).unref();
	const release = (): void => {
		clearInterval(refresh);
		process.removeListener('exit', release);
		try {
			fs.unlinkSync(lockPath); }
		catch { /* ignored */ }
	};
	process.on('exit', release);
	return release;
}
