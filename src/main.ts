import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
} from "obsidian";
import * as L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import {
	DEFAULT_SETTINGS,
	type CodeBlockOptions,
	type MapDrawSettings,
} from "./types";
import { MapDrawSettingTab } from "./settings";
import { ensureMapDataStub, readMapData } from "./data/MapData";
import { MapView } from "./view/MapView";
import { SnapshotView } from "./view/SnapshotView";

export default class MapDrawPlugin extends Plugin {
	settings!: MapDrawSettings;
	private liveViews = new Map<string, Set<MapRenderChild>>();
	private styleEl: HTMLStyleElement | null = null;

	async onload() {
		await this.loadSettings();
		this.injectLeafletCss();
		patchLeafletDefaultIcon();
		this.addSettingTab(new MapDrawSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor("mapdraw", (source, el, ctx) => {
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
		style.setAttribute("data-mapdraw", "leaflet");
		style.textContent = leafletCss as unknown as string;
		document.head.appendChild(style);
		this.styleEl = style;
	}

	private renderCodeBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const opts = parseOptions(source);
		if (!opts.source) {
			el.createDiv({ cls: "mapdraw-error", text: "MapDraw: 'source' is required (path to sidecar JSON)." });
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
	plugin: MapDrawPlugin;
	options: CodeBlockOptions;
	ctx: MarkdownPostProcessorContext;
	private mapView: MapView | null = null;
	private snapshotView: SnapshotView | null = null;
	private lastSerialized = "";

	constructor(plugin: MapDrawPlugin, container: HTMLElement, options: CodeBlockOptions, ctx: MarkdownPostProcessorContext) {
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
		const data = await readMapData(this.plugin.app, this.options.source);
		if (!data) {
			this.renderMissing();
			return;
		}
		const serialized = JSON.stringify(data);
		const modeMatches = data.snapshotPath ? !!this.snapshotView : !!this.mapView;
		if (!force && modeMatches && serialized === this.lastSerialized) return;
		this.lastSerialized = serialized;

		this.mapView?.destroy();
		this.mapView = null;
		this.snapshotView?.destroy();
		this.snapshotView = null;

		if (data.snapshotPath) {
			this.snapshotView = new SnapshotView({
				app: this.plugin.app,
				container: this.containerEl,
				data,
				sourcePath: this.ctx.sourcePath,
				options: this.options,
				onPersisted: (s) => { this.lastSerialized = s; },
				onModeChange: () => { void this.refresh(); },
			});
			this.snapshotView.render();
			return;
		}

		const readonly = isReadingMode(this.containerEl);
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

	private renderMissing() {
		this.containerEl.empty();
		const wrap = this.containerEl.createDiv({ cls: "mapdraw-missing" });
		wrap.createEl("p", { text: `MapDraw: no map at "${this.options.source}".` });
		const btn = wrap.createEl("button", { text: "Create map at this path" });
		btn.onclick = async () => {
			try {
				await ensureMapDataStub(this.plugin.app, this.options.source);
				new Notice("MapDraw: created map sidecar");
				await this.refresh();
			} catch (e) {
				console.error(e);
				new Notice("MapDraw: failed to create map (see console)");
			}
		};
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
				out.source = value;
				break;
			case "provider":
				out.provider = value;
				break;
			case "overlay":
				out.overlay = value;
				break;
			case "height":
				out.height = Number(value);
				break;
			case "defaultZoom":
				out.defaultZoom = Number(value);
				break;
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
	let cur: HTMLElement | null = el;
	while (cur) {
		if (cur.classList?.contains("markdown-reading-view")) return true;
		if (cur.classList?.contains("markdown-source-view")) return false;
		cur = cur.parentElement;
	}
	return false;
}
