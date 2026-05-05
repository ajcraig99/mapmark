import { type App, TFile, normalizePath } from "obsidian";
import type { MapData } from "../types";

export type ReadResult =
	| { kind: "missing" }
	| { kind: "corrupt"; error: string }
	| { kind: "ok"; data: MapData };

export async function readMapData(app: App, path: string): Promise<ReadResult> {
	const file = app.vault.getFileByPath(normalizePath(path));
	if (!(file instanceof TFile)) return { kind: "missing" };
	const raw = await app.vault.read(file);
	try {
		const parsed = JSON.parse(raw) as Partial<MapData>;
		const view = parsed?.view;
		const locked = parsed?.locked;
		const snapshotPath = parsed?.snapshotPath;
		const shapes = Array.isArray(parsed?.shapes) ? parsed.shapes! : [];
		return { kind: "ok", data: { schemaVersion: 1, view, locked, snapshotPath, shapes } };
	} catch (e) {
		// Don't fall back to an empty map — the next autosave would silently
		// overwrite a recoverable file. Surface the parse error so the caller
		// can show a banner and refuse to mount the editor.
		return { kind: "corrupt", error: e instanceof Error ? e.message : String(e) };
	}
}

export async function writeMapData(app: App, path: string, data: MapData): Promise<void> {
	const normalized = normalizePath(path);
	await ensureParent(app, normalized);
	const text = JSON.stringify(data, null, 2);
	const file = app.vault.getFileByPath(normalized);
	if (file instanceof TFile) {
		await app.vault.process(file, () => text);
	} else {
		await app.vault.create(normalized, text);
	}
}

export async function ensureMapDataStub(app: App, path: string): Promise<MapData> {
	const stub: MapData = { schemaVersion: 1, shapes: [] };
	await writeMapData(app, path, stub);
	return stub;
}

async function ensureParent(app: App, path: string): Promise<void> {
	const idx = path.lastIndexOf("/");
	if (idx <= 0) return;
	const dir = path.slice(0, idx);
	if (app.vault.getAbstractFileByPath(dir)) return;
	try {
		await app.vault.createFolder(dir);
	} catch {
		// Race: another save just created it. createFolder throws on "already exists".
	}
}

export interface DebouncedSave {
	(): void;
	cancel(): void;
}

export function debounceSave(fn: () => void | Promise<void>, ms = 500): DebouncedSave {
	let handle: number | null = null;
	const debounced = (() => {
		if (handle !== null) window.clearTimeout(handle);
		handle = window.setTimeout(() => {
			handle = null;
			void fn();
		}, ms);
	}) as DebouncedSave;
	debounced.cancel = () => {
		if (handle !== null) {
			window.clearTimeout(handle);
			handle = null;
		}
	};
	return debounced;
}
