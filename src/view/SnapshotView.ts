import type { App } from "obsidian";
import { setIcon, Notice, TFile } from "obsidian";
import type { MapData } from "../types";
import { writeMapData } from "../data/MapData";

export interface SnapshotViewOptions {
	app: App;
	container: HTMLElement;
	data: MapData;
	sourcePath: string;
	options: { source: string; height?: number };
	readonly: boolean;
	onModeChange: () => void;
	onPersisted?: (serialized: string) => void;
}

export class SnapshotView {
	private opts: SnapshotViewOptions;

	constructor(opts: SnapshotViewOptions) {
		this.opts = opts;
	}

	render() {
		const { container, data, app } = this.opts;
		container.empty();
		container.addClass("mapmark-root");

		const wrap = container.createDiv({ cls: "mapmark-snapshot" });

		const img = wrap.createEl("img", { cls: "mapmark-snapshot-img" });
		const path = data.snapshotPath!;
		img.src = app.vault.adapter.getResourcePath(path);
		img.alt = `Snapshot of ${this.opts.options.source}`;
		if (this.opts.options.height) img.style.maxHeight = `${this.opts.options.height}px`;
		img.onerror = () => {
			img.addClass("mapmark-hidden");
			wrap.createDiv({ cls: "mapmark-error", text: `MapMark: snapshot image not found at "${path}".` });
		};

		// Reading mode: image only, no edit/delete chrome — readers must not be
		// able to clear sidecar state or trash the PNG from a rendered note.
		if (this.opts.readonly) return;

		const bar = wrap.createDiv({ cls: "mapmark-snapshot-bar" });
		bar.createSpan({ cls: "mapmark-snapshot-label", text: "Snapshot — live map collapsed" });

		const editBtn = bar.createEl("button", { cls: "mapmark-btn" });
		editBtn.title = "Edit map (clear snapshot)";
		editBtn.setAttr("aria-label", "Edit map");
		setIcon(editBtn, "pencil");
		editBtn.onclick = async () => {
			await this.clearSnapshot(/* deleteFile */ false);
		};

		const removeBtn = bar.createEl("button", { cls: "mapmark-btn" });
		removeBtn.title = "Remove snapshot (deletes the PNG file)";
		removeBtn.setAttr("aria-label", "Remove snapshot");
		setIcon(removeBtn, "trash-2");
		removeBtn.onclick = async () => {
			await this.clearSnapshot(/* deleteFile */ true);
		};
	}

	private async clearSnapshot(deleteFile: boolean) {
		const path = this.opts.data.snapshotPath;
		this.opts.data.snapshotPath = undefined;
		try {
			if (deleteFile && path) {
				const file = this.opts.app.vault.getFileByPath(path);
				if (file instanceof TFile) {
					await this.opts.app.fileManager.trashFile(file);
				}
			}
			const fingerprint = JSON.stringify(this.opts.data);
			await writeMapData(this.opts.app, this.opts.options.source, this.opts.data);
			this.opts.onPersisted?.(fingerprint);
			this.opts.onModeChange();
		} catch (err) {
			console.error("MapMark: failed to clear snapshot", err);
			new Notice("MapMark: failed to clear snapshot (see console)");
		}
	}

	destroy() {
		this.opts.container.empty();
	}
}
