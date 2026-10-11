import * as clack from '@clack/prompts';
import crypto from 'crypto';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

import { MapDescriptor } from '@mtg-shared/map_descriptor';

type HitObject = {
	StartTime: number;
	Lane:      number;
	EndTime?:  number;
	Type?:     string;
}

type TimingPoint = {
	StartTime:  number;
	Bpm:        number;
	Signature?: number;
}

type SliderVelocity = {
	StartTime:  number;
	Multiplier: number;
};

type Map = {
	Title?:            string;
	Artist?:           string;
	Creator?:          string;
	DifficultyName?:   string;
	MapId?:            number;
	MapSetId?:         number;
	Mode?:             string;
	HitObjects?:       HitObject[];
	TimingPoints?:     TimingPoint[];
	SliderVelocities?: SliderVelocity[];
}

export type ScanResult = {
	filePath:   string;
	descriptor: MapDescriptor;
};

const computeContentFingerprint = (doc: Map): string => {
	const h   = crypto.createHash('md5');
	const hos = [...(doc.HitObjects ?? [])].sort(
		(a, b) => (a.StartTime - b.StartTime) || (a.Lane - b.Lane));
	for (const ho of hos)
		h.update(`${ho.StartTime}:${ho.Lane}:${ho.EndTime ?? 0}:${ho.Type ?? 'Normal'}|`);
	const tps = [...(doc.TimingPoints ?? [])].sort((a, b) => a.StartTime - b.StartTime);
	for (const tp of tps)
		h.update(`${tp.StartTime}:${tp.Bpm}:${tp.Signature ?? 4}|`);
	const svs = [...(doc.SliderVelocities ?? [])].sort((a, b) => a.StartTime - b.StartTime);
	for (const sv of svs)
		h.update(`${sv.StartTime}:${sv.Multiplier}|`);
	return h.digest('hex');
}

const buildDescriptor = (doc: Map): MapDescriptor => {
	const hos    = doc.HitObjects ?? [];
	let mapLenMs = 0;
	for (const ho of hos) {
		const t = Math.max(ho.StartTime, ho.EndTime ?? 0);
		if (t > mapLenMs) mapLenMs = t;
	}
	const firstTp = doc.TimingPoints?.[0];
	return {
		title: doc.Title ?? '(untitled)',
		artist: doc.Artist ?? '',
		creator: doc.Creator ?? '',
		difficultyName: doc.DifficultyName ?? '',
		mapId: doc.MapId ?? 0,
		mapSetId: doc.MapSetId ?? 0,
		mode: doc.Mode?? 'Keys4',
		fingerprint: computeContentFingerprint(doc),
		noteCount: hos.length,
		mapLenMs,
		bpm: firstTp ? Math.round(firstTp.Bpm) : 0,
	};
}

const scanQuaFile = async (filePath: string, marker: string): Promise<ScanResult | null> => {
	let text: string;
	try {
		text = await fs.promises.readFile(filePath, 'utf8');
	} catch { return null; }
	if (!text.includes(marker)) return null;
	return {
		filePath,
		descriptor: buildDescriptor(parseQua(filePath, text)),
	};
}

const parseQua = (filePath: string, text: string): Map => {
	try {
		const doc = yaml.load(text, { json: true });
		if (doc && typeof doc === 'object') return doc as Map;
	} catch (e) {
		const reason = e instanceof Error ? e.message.split('\n')[0] : String(e);
		clack.log.warn(`Could not fully read ${path.basename(filePath)} (${reason}), using its header only.`);
	}
	return readHeader(text);
}

const readHeader = (text: string): Map => {
	const field = (key: string): string | undefined => {
		const raw = text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim();
		if (raw === undefined) return;
		if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
		if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
		return raw;
	};
	const number = (key: string): number | undefined => {
		const value = Number(field(key));
		return Number.isFinite(value) ? value : undefined;
	};

	const header: Map = {};
	for (const key of ['Title', 'Artist', 'Creator', 'DifficultyName', 'Mode'] as const) {
		const value = field(key);
		if (value !== undefined) header[key] = value;
	}
	for (const key of ['MapId', 'MapSetId'] as const) {
		const value = number(key);
		if (value !== undefined) header[key] = value;
	}
	return header;
}

const isModifiedSince = async (filePath: string, since: number): Promise<boolean> => {
	try {
		return (await fs.promises.stat(filePath)).mtimeMs >= since;
	} catch { return false; }
}

const scanMapset = async (mapsetDir: string, marker: string, since: number): Promise<ScanResult | null> => {
	let files: string[];
	try {
		const stat = await fs.promises.stat(mapsetDir);
		if (!stat.isDirectory()) return null;
		files = await fs.promises.readdir(mapsetDir);
	} catch { return null; }
	for (const file of files) {
		if (!file.endsWith('.qua')) continue;
		const filePath = path.join(mapsetDir, file);
		if (!await isModifiedSince(filePath, since)) continue;
		const result = await scanQuaFile(filePath, marker);
		if (result) return result;
	}
	return null;
}

export const scanForMarker = async (songsDir: string, secret: string, since: number): Promise<ScanResult | null> => {
	const marker = '__MAP_FINDER__:' + secret;
	let roots: string[];
	try {
		roots = await fs.promises.readdir(songsDir);
	} catch { return null; }
	for (const root of roots) {
		const result = await scanMapset(path.join(songsDir, root), marker, since);
		if (result) return result;
	}
	return null;
}
