import * as clack from '@clack/prompts';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';

import { findQuaverDirs, songsDirOf } from '@mtg-companion/quaver-dir';

const execAsync = promisify(exec);

export type PersistData = {
	songsDir?: string;
};

export const loadPersist = (persistPath: string): PersistData => {
	try {
		return JSON.parse(fs.readFileSync(persistPath, 'utf8')) as PersistData;
	} catch { return {}; }
}

export const savePersist = (persistPath: string, data: PersistData): void => {
	fs.writeFileSync(persistPath, JSON.stringify(data, null, 2), 'utf8');
}

const openFolderPickerWin = async (start: string): Promise<string | null> => {
	const escaped = start.replace(/'/g, "''");
	const script = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinFolderPicker {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string p, IntPtr b, [In] ref Guid r,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem v);
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint n, IntPtr p); void SetFileTypeIndex(uint i);
        void GetFileTypeIndex(out uint i); void Advise(IntPtr p, out uint c);
        void Unadvise(uint c); void SetOptions(uint fos); void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem psi); void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi); void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
        void GetResult(out IShellItem ppsi); void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string ext);
        void Close(int hr); void SetClientGuid(ref Guid g); void ClearClientData();
        void SetFilter([MarshalAs(UnmanagedType.Interface)] object f);
    }
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        void BindToHandler(IntPtr p, ref Guid b, ref Guid r, out IntPtr v);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint n, [MarshalAs(UnmanagedType.LPWStr)] out string s);
        void GetAttributes(uint m, out uint a); void Compare(IShellItem i, uint h, out int o);
    }
    public static string Pick(string title, string startPath) {
        var d = (IFileDialog)Activator.CreateInstance(
            Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")));
        d.SetOptions(0x20 | 0x40);
        d.SetTitle(title);
        try {
            var riid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
            IShellItem si;
            SHCreateItemFromParsingName(startPath, IntPtr.Zero, ref riid, out si);
            d.SetDefaultFolder(si);
        } catch {}
        if (d.Show(IntPtr.Zero) != 0) return null;
        IShellItem item; d.GetResult(out item);
        string p; item.GetDisplayName(0x80058000, out p);
        return p;
    }
}
'@
[WinFolderPicker]::Pick('Select your Quaver Songs directory', '${escaped}')`;

	const tmp = path.join(tmpdir(), 'mt-picker.ps1');
	try {
		fs.writeFileSync(tmp, script, 'utf8');
		const { stdout } = await execAsync(
			`"${windowsTool('WindowsPowerShell', 'v1.0', 'powershell.exe')}" -ExecutionPolicy Bypass -WindowStyle Hidden -File "${tmp}"`,
			{ windowsHide: true },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	} finally {
		try {
			fs.unlinkSync(tmp);
		} catch { /* ignored */ }
	}
}

const openFolderPicker = async (startDir: string): Promise<string | null> => {
	const start = startDir || os.homedir();
	if (process.platform === 'win32') return openFolderPickerWin(start);
	if (process.platform === 'darwin') {
		try {
			const { stdout } = await execAsync(`osascript -e 'POSIX path of (choose folder with prompt "Select your Quaver Songs directory")'`);
			return stdout.trim().replace(/\/$/, '') || null;
		} catch { return null; }
	}
	for (const cmd of [
		`zenity --file-selection --directory --title="Select Quaver Songs directory"`,
		`kdialog --getexistingdirectory "${start}" "Select Quaver Songs directory"`,
	]) {
		try {
			const { stdout } = await execAsync(cmd);
			return stdout.trim() || null;
		} catch { /* try next */ }
	}
	return null;
}

const hasQuaFiles = (dir: string): boolean => {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	}
	catch { return false; }
	if (entries.some(e => e.isFile() && e.name.endsWith('.qua'))) return true;
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		try {
			if (fs.readdirSync(path.join(dir, e.name)).some(f => f.endsWith('.qua')))
				return true;
		} catch { /* ignored */ }
	}
	return false;
}

const findSongsDir = (startPath: string): string | null => {
	if (hasQuaFiles(startPath)) return startPath;
	const sub = path.join(startPath, 'Songs');
	if (hasQuaFiles(sub)) return sub;
	let current = startPath;
	for (let i = 0; i < 3; i++) {
		const parent = path.dirname(current);
		if (parent === current) break;
		if (hasQuaFiles(parent)) return parent;
		const parentSub = path.join(parent, 'Songs');
		if (hasQuaFiles(parentSub)) return parentSub;
		current = parent;
	}
	return null;
}

const getCachedDir = (persistPath: string, resetFlag: boolean): string | null => {
	if (process.env['MT_SONGS_DIR']) return process.env['MT_SONGS_DIR'];
	if (resetFlag) return null;
	const persist = loadPersist(persistPath);
	if (persist.songsDir && fs.existsSync(persist.songsDir)) return persist.songsDir;
	return null;
}

const windowsTool = (...parts: string[]): string => {
	return path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', ...parts);
}

const detectSongsDir = (): string | null => {
	return findQuaverDirs().map(songsDirOf).find((dir) => fs.existsSync(dir)) ?? null;
}

const promptSongsDir = async (): Promise<string | null> => {
	const answer = await clack.text({
		message: 'Paste the path to your Quaver Songs folder (leave empty to quit)',
		placeholder: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Quaver\\Songs',
	});
	if (clack.isCancel(answer) || !answer?.trim()) return null;
	return answer.trim().replace(/^"(.*)"$/, '$1');
}

const pickSongsDir = async (persistPath: string): Promise<string> => {
	const persist = loadPersist(persistPath);
	let resolved: string | null = null;
	while (!resolved) {
		const chosen = await openFolderPicker(persist.songsDir ?? os.homedir()) ?? await promptSongsDir();
		if (!chosen) {
			clack.cancel('No directory selected.');
			process.exit(0);
		}
		resolved = findSongsDir(chosen);
		if (!resolved) {
			clack.log.warn(`No .qua files found in or near "${chosen}" - please try again.`);
		} else if (resolved !== chosen) {
			clack.log.info(`Found Songs directory: ${resolved}`);
		}
	}
	savePersist(persistPath, {
		...persist,
		songsDir: resolved,
	});
	clack.log.success(`Saved: ${resolved}`);
	return resolved;
}

export const chooseSongsDir = async (persistPath: string): Promise<string | null> => {
	const persist = loadPersist(persistPath);
	const chosen = await openFolderPicker(persist.songsDir ?? os.homedir());
	if (!chosen) return null;
	const resolved = findSongsDir(chosen);
	if (!resolved) return null;
	savePersist(persistPath, {
		...persist,
		songsDir: resolved,
	});
	return resolved;
}

export const getSongsDir = async (persistPath: string, resetFlag: boolean): Promise<string> => {
	const cached = getCachedDir(persistPath, resetFlag);
	if (cached) {
		if (!resetFlag) clack.log.info(`Songs: ${cached}  (--reset to change)`);
		return cached;
	}
	if (resetFlag) {
		clack.log.info('Re-selecting Quaver Songs directory…');
		return pickSongsDir(persistPath);
	}

	const detected = detectSongsDir();
	if (detected) {
		savePersist(persistPath, {
			...loadPersist(persistPath),
			songsDir: detected,
		});
		clack.log.success(`Found Quaver Songs directory: ${detected}  (--reset to change)`);
		return detected;
	}

	clack.log.warn('Quaver Songs directory not found - opening folder picker…');
	return pickSongsDir(persistPath);
}
