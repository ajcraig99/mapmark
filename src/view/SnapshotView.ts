import type { App } from "obsidian";
import { setIcon, Notice } from "obsidian";
import type { MapData } from "../types";
import { writeMapData } from "../data/MapData";

export interface SnapshotViewOptions {
	app: App;
	container: HTMLElement;
	data: MapData;
	sourcePath: string;
	options: { source: string; height?: number };
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
		container.addClass("mapdraw-root");

		const wrap = container.createDiv({ cls: "mapdraw-snapshot" });

		const img = wrap.createEl("img", { cls: "mapdraw-snapshot-img" });
		const path = data.snapshotPath!;
		img.src = app.vault.adapter.getResourcePath(path);
		img.alt = `Snapshot of ${this.opts.options.source}`;
		if (this.opts.options.height) img.style.maxHeight = `${this.opts.options.height}px`;
		img.onerror = () => {
			img.style.display = "none";
			wrap.createDiv({ cls: "mapdraw-error", text: `MapDraw: snapshot image not found at "${path}".` });
		};

		const bar = wrap.createDiv({ cls: "mapdraw-snapshot-bar" });
		bar.createSpan({ cls: "mapdraw-snapshot-label", text: "Snapshot — live map collapsed" });

		const editBtn = bar.createEl("button", { cls: "mapdraw-btn" });
		editBtn.title = "Edit map (clear snapshot)";
		editBtn.setAttr("aria-label", "Edit map");
		setIcon(editBtn, "pencil");
		editBtn.onclick = async () => {
			await this.clearSnapshot(/* deleteFile */ false);
		};

		const removeBtn = bar.createEl("button", { cls: "mapdraw-btn" });
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
			if (deleteFile && path && (await this.opts.app.vault.adapter.exists(path))) {
				await this.opts.app.vault.adapter.remove(path);
			}
			const fingerprint = JSON.stringify(this.opts.data);
			await writeMapData(this.opts.app, this.opts.options.source, this.opts.data);
			this.opts.onPersisted?.(fingerprint);
			this.opts.onModeChange();
		} catch (err) {
			console.error("MapDraw: failed to clear snapshot", err);
			new Notice("MapDraw: failed to clear snapshot (see console)");
		}
	}

	destroy() {
		this.opts.container.empty();
	}
}
