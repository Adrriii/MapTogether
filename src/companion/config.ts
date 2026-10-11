import os from 'os';
import path from 'path';

import { __dir } from '@lib/fs';

export const VERSION = 'v1.0.1';

export const PERSIST_PATH = path.join(__dir, 'companion.json');
export const LOCK_PATH = path.join(os.tmpdir(), 'maptogether-companion.lock');
