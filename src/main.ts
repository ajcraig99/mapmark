import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	normalizePath,
} from "obsidian";
import * as L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import {
	DEFAULT_SETTINGS,
	type CodeBlockOptions,
	type MapMarkSettings,
} from "./types";
import { MapMarkSettingTab } from "./settings";
import { ensureMapDataStub, readMapData } from "./data/MapData";
import { MapView } from "./view/MapView";
import { SnapshotView } from "./view/SnapshotView";

export default class MapMarkPlugin extends Plugin {
	settings!: MapMarkSettings;
	private liveViews = new Map<string, Set<MapRenderChild>>();
	private styleEl: HTMLStyleElement | null = null;

	async onload() {
		await this.loadSettings();
		this.injectLeafletCss();
		patchLeafletDefaultIcon();
		this.addSettingTab(new MapMarkSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor("mapmark", (source, el, ctx) => {
			this.renderCodeBlock(source, el, ctx);
		});

		this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultModify(file)));
	}

	onunload() {
		for (const set of this.liveViews.values()) {
			for (const child of set) child.unload();
		}
		this.liveViews.clear();
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private injectLeafletCss() {
		const style = document.createElement("style");
		style.setAttribute("data-mapmark", "leaflet");
		style.textContent = leafletCss as unknown as string;
		document.head.appendChild(style);
		this.styleEl = style;
	}

	private renderCodeBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const opts = parseOptions(source);
		if (!opts.source) {
			el.createDiv({ cls: "mapmark-error", text: "MapMark: 'source' is required (path to sidecar JSON)." });
			return;
		}
		const child = new MapRenderChild(this, el, opts, ctx);
		ctx.addChild(child);
	}

	registerLiveView(child: MapRenderChild) {
		const path = child.options.source;
		let set = this.liveViews.get(path);
		if (!set) {
			set = new Set();
			this.liveViews.set(path, set);
		}
		set.add(child);
	}

	unregisterLiveView(child: MapRenderChild) {
		const path = child.options.source;
		const set = this.liveViews.get(path);
		if (!set) return;
		set.delete(child);
		if (set.size === 0) this.liveViews.delete(path);
	}

	private onVaultModify(file: TAbstractFile) {
		if (!(file instanceof TFile)) return;
		const set = this.liveViews.get(file.path);
		if (!set) return;
		for (const child of set) {
			void child.refresh();
		}
	}
}

export class MapRenderChild extends MarkdownRenderChild {
	plugin: MapMarkPlugin;
	options: CodeBlockOptions;
	ctx: MarkdownPostProcessorContext;
	private mapView: MapView | null = null;
	private snapshotView: SnapshotView | null = null;
	private lastSerialized = "";

	constructor(plugin: MapMarkPlugin, container: HTMLElement, options: CodeBlockOptions, ctx: MarkdownPostProcessorContext) {
		super(container);
		this.plugin = plugin;
		this.options = options;
		this.ctx = ctx;
	}

	onload(): void {
		void this.refresh();
		this.plugin.registerLiveView(this);
	}

	onunload(): void {
		this.mapView?.destroy();
		this.snapshotView?.destroy();
		this.mapView = null;
		this.snapshotView = null;
		this.plugin.unregisterLiveView(this);
	}

	async refresh(force = false) {
		const result = await readMapData(this.plugin.app, this.options.source);
		if (result.kind === "missing") {
			this.tearDownViews();
			this.lastSerialized = "";
			this.renderMissing();
			return;
		}
		if (result.kind === "corrupt") {
			// Critical: do NOT mount the editor. The autosave path would happily
			// overwrite the user's broken-but-recoverable file with an empty map.
			this.tearDownViews();
			this.lastSerialized = "";
			this.renderCorrupt(result.error);
			return;
		}
		const data = result.data;
		const serialized = JSON.stringify(data);
		const modeMatches = data.snapshotPath ? !!this.snapshotView : !!this.mapView;
		if (!force && modeMatches && serialized === this.lastSerialized) return;
		this.lastSerialized = serialized;

		this.tearDownViews();

		const readonly = isReadingMode(this.containerEl);
		if (data.snapshotPath) {
			this.snapshotView = new SnapshotView({
				app: this.plugin.app,
				container: this.containerEl,
				data,
				sourcePath: this.ctx.sourcePath,
				options: this.options,
				readonly,
				onPersisted: (s) => { this.lastSerialized = s; },
				onModeChange: () => { void this.refresh(); },
			});
			this.snapshotView.render();
			return;
		}

		this.mapView = new MapView({
			app: this.plugin.app,
			container: this.containerEl,
			data,
			settings: this.plugin.settings,
			options: this.options,
			sourcePath: this.ctx.sourcePath,
			readonly,
			onPersisted: (serialized) => { this.lastSerialized = serialized; },
			onSnapshotChange: () => { void this.refresh(); },
		});
		this.mapView.render();
	}

	private tearDownViews() {
		this.mapView?.destroy();
		this.mapView = null;
		this.snapshotView?.destroy();
		this.snapshotView = null;
	}

	private renderMissing() {
		this.containerEl.empty();
		const wrap = this.containerEl.createDiv({ cls: "mapmark-missing" });
		wrap.createEl("p", { text: `MapMark: no map at "${this.options.source}".` });
		const btn = wrap.createEl("button", { text: "Create map at this path" });
		btn.onclick = async () => {
			try {
				await ensureMapDataStub(this.plugin.app, this.options.source);
				new Notice("MapMark: created map sidecar");
				await this.refresh();
			} catch (e) {
				console.error(e);
				new Notice("MapMark: failed to create map (see console)");
			}
		};
	}

	private renderCorrupt(error: string) {
		this.containerEl.empty();
		const wrap = this.containerEl.createDiv({ cls: "mapmark-error" });
		wrap.createEl("p", {
			text: `MapMark: cannot parse "${this.options.source}". The map is not loaded so editing it cannot overwrite the file. Fix the JSON in your editor and the map will reload automatically.`,
		});
		wrap.createEl("p", { text: `Parse error: ${error}` });
	}
}

function parseOptions(source: string): CodeBlockOptions {
	const out: Partial<CodeBlockOptions> = {};
	const lines = source.split(/\r?\n/);
	for (const raw of lines) {
		const line = raw.replace(/#.*$/, "").trim();
		if (!line) continue;
		const idx = line.indexOf(":");
		if (idx < 0) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (!value) continue;
		switch (key) {
			case "source":
				out.source = normalizePath(value);
				break;
			case "provider":
				out.provider = value;
				break;
			case "overlay":
				out.overlay = value;
				break;
			case "height": {
				const n = Number(value);
				if (Number.isFinite(n) && n > 0) out.height = n;
				break;
			}
			case "defaultZoom": {
				const n = Number(value);
				if (Number.isFinite(n)) out.defaultZoom = n;
				break;
			}
		}
	}
	return { source: out.source ?? "", provider: out.provider, overlay: out.overlay, height: out.height, defaultZoom: out.defaultZoom };
}

function patchLeafletDefaultIcon() {
	// Leaflet's default marker references images via relative URLs in its CSS,
	// which fail under Obsidian's electron context. Bake the bundled data URIs in.
	const proto = (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown });
	delete proto._getIconUrl;
	L.Icon.Default.mergeOptions({
		iconUrl: markerIconUrl,
		iconRetinaUrl: markerIconRetinaUrl,
		shadowUrl: markerShadowUrl,
	});
}

function isReadingMode(el: HTMLElement): boolean {
	// Source / Live Preview wins if it's the *closer* ancestor: Obsidian's
	// reading view sometimes also has a .markdown-preview-view ancestor in
	// embeds/exports, but in source mode it doesn't.
	if (el.closest(".markdown-source-view")) return false;
	return !!el.closest(".markdown-reading-view, .markdown-preview-view");
}
