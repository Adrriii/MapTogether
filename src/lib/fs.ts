import path            from 'path';
import { fileURLToPath } from 'url';

const _isSea = !path.basename(process.execPath, '.exe').toLowerCase().startsWith('bun');

export const __dir = _isSea
	? path.dirname(process.execPath)
	: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const IS_COMPILED = _isSea;
