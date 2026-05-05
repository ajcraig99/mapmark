import type { App } from "obsidian";
import type { MapData } from "../types";
import { emptyMapData } from "../types";

export async function readMapData(app: App, path: string): Promise<MapData | null> {
	const exists = await app.vault.adapter.exists(path);
	if (!exists) return null;
	const raw = await app.vault.adapter.read(path);
	try {
		const parsed = JSON.parse(raw) as Partial<MapData>;
		const view = parsed?.view;
		const locked = parsed?.locked;
		const snapshotPath = parsed?.snapshotPath;
		const shapes = Array.isArray(parsed?.shapes) ? parsed.shapes! : [];
		return { schemaVersion: 1, view, locked, snapshotPath, shapes };
	} catch {
		return emptyMapData();
	}
}

export async function writeMapData(app: App, path: string, data: MapData): Promise<void> {
	await ensureParent(app, path);
	const text = JSON.stringify(data, null, 2);
	await app.vault.adapter.write(path, text);
}

export async function ensureMapDataStub(app: App, path: string): Promise<MapData> {
	const stub = emptyMapData();
	await writeMapData(app, path, stub);
	return stub;
}

async function ensureParent(app: App, path: string): Promise<void> {
	const idx = path.lastIndexOf("/");
	if (idx <= 0) return;
	const dir = path.slice(0, idx);
	const exists = await app.vault.adapter.exists(dir);
	if (!exists) {
		await app.vault.adapter.mkdir(dir);
	}
}

export function debounceSave(fn: () => void | Promise<void>, ms = 500): () => void {
	let handle: number | null = null;
	return () => {
		if (handle !== null) window.clearTimeout(handle);
		handle = window.setTimeout(() => {
			handle = null;
			void fn();
		}, ms);
	};
}
