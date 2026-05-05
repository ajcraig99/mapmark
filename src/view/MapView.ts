import * as L from "leaflet";
import { App, Notice, setIcon } from "obsidian";
import type {
	CodeBlockOptions,
	LatLng,
	MapData,
	MapDrawSettings,
	Shape,
} from "../types";
import { toPng } from "html-to-image";
import { listProviders, resolveProvider, type ResolvedProvider } from "../tileProviders";
import { writeMapData, debounceSave } from "../data/MapData";
import { DrawTools } from "./DrawTools";
import { StylePanel } from "./StylePanel";
import { createTextMarker, updateTextMarker } from "./TextOverlay";
import { NoteLinkSuggester } from "./NoteLinkSuggester";

export interface MapViewOptions {
	app: App;
	container: HTMLElement;
	data: MapData;
	settings: MapDrawSettings;
	options: CodeBlockOptions;
	sourcePath: string;
	readonly: boolean;
	onPersisted?: (serialized: string) => void;
	onSnapshotChange?: () => void;
}

export class MapView {
	private app: App;
	private container: HTMLElement;
	private data: MapData;
	private settings: MapDrawSettings;
	private options: CodeBlockOptions;
	private sourcePath: string;
	private readonly: boolean;

	private wrapEl!: HTMLDivElement;
	private mapEl!: HTMLDivElement;
	private overlayEl!: HTMLDivElement;
	private map!: L.Map;
	private tileLayer: L.TileLayer | null = null;
	private overlayLayer: L.TileLayer | null = null;
	private currentProviderId = "";
	private currentOverlayId = "";

	private layers = new Map<string, L.Layer>();
	private editHandles: L.Layer[] = [];
	private selectedId: string | null = null;

	private toolbar: DrawTools | null = null;
	private stylePanel: StylePanel | null = null;
	private banner: HTMLDivElement | null = null;
	private coordEl: HTMLSpanElement | null = null;
	private lockBtn: HTMLButtonElement | null = null;
	private loadingEl: HTMLDivElement | null = null;
	private loadingCount = 0;
	private erroredProviders = new Set<string>();
	private resizeObserver: ResizeObserver | null = null;

	private save: () => void;
	private onPersisted?: (serialized: string) => void;
	private onSnapshotChange?: () => void;

	constructor(opts: MapViewOptions) {
		this.app = opts.app;
		this.container = opts.container;
		this.data = opts.data;
		this.settings = opts.settings;
		this.options = opts.options;
		this.sourcePath = opts.sourcePath;
		this.readonly = opts.readonly;
		this.onPersisted = opts.onPersisted;
		this.onSnapshotChange = opts.onSnapshotChange;

		this.save = debounceSave(async () => {
			const fingerprint = JSON.stringify(this.data);
			await writeMapData(this.app, this.options.source, this.data);
			this.onPersisted?.(fingerprint);
		}, 500);
	}

	render() {
		this.container.empty();
		this.container.addClass("mapdraw-root");

		// Wrap structure: our overlays are siblings of the Leaflet container, not
		// children. This insulates them from any other plugin's CSS rules that
		// target .leaflet-container descendants (e.g. obsidian-leaflet-plugin
		// hides .leaflet-control-zoom — that rule would otherwise hit us).
		this.wrapEl = this.container.createDiv({ cls: "mapdraw-wrap" });
		this.mapEl = this.wrapEl.createDiv({ cls: "mapdraw-map" });
		this.mapEl.style.height = `${this.options.height ?? this.settings.defaultHeight}px`;
		this.overlayEl = this.wrapEl.createDiv({ cls: "mapdraw-overlays" });

		const initialProvider = this.options.provider || this.data.view?.provider || this.settings.defaultProvider;
		const initialOverlay = this.options.overlay || this.data.view?.overlay || "";
		const isFresh = !this.data.view?.center && this.data.shapes.length === 0;
		const initialCenter: LatLng = this.data.view?.center ?? (isFresh ? FALLBACK_CENTER : [0, 0]);
		const initialZoom = this.options.defaultZoom ?? this.data.view?.zoom ?? (isFresh ? FALLBACK_ZOOM : this.settings.defaultZoom);

		this.map = L.map(this.mapEl, {
			center: initialCenter as L.LatLngExpression,
			zoom: initialZoom,
			// We render our own zoom +/- buttons in the overlay so cross-plugin
			// CSS that hides .leaflet-control-zoom can't take ours out.
			zoomControl: false,
			attributionControl: true,
		});

		this.applyProvider(initialProvider);
		if (initialOverlay) this.applyOverlay(initialOverlay);

		this.renderShapes();
		if (this.shouldFitBounds() && this.data.shapes.length > 0) {
			this.fitToShapes();
		}
		// Auto-geolocation removed: Obsidian's Electron renderer hits Google's
		// network-location backend without an API key and gets a 403 every time.
		// Users can press the "Find me" button to try manually.

		// In reading mode, render the map and shapes only — no chrome.
		// Controls like provider switch / save / snapshot / lock are all
		// edit-time concerns; hiding them avoids the confusing case where a
		// reader can change the visible provider mid-document.
		if (!this.readonly) {
			this.buildControls();
		}

		if (!this.readonly) {
			this.toolbar = new DrawTools({
				app: this.app,
				map: this.map,
				host: this.overlayEl,
				onShape: (shape) => this.addShape(shape),
				getSettings: () => this.settings,
				sourcePath: this.sourcePath,
			});
			this.toolbar.mount();

			this.stylePanel = new StylePanel({
				app: this.app,
				host: this.overlayEl,
				sourcePath: this.sourcePath,
				onChange: (shape) => this.onShapeStyleChanged(shape),
				onDelete: (shape) => this.deleteShape(shape.id),
			});

			this.mapEl.tabIndex = 0;
			this.mapEl.addEventListener("keydown", this.onKey);
		}

		this.applyLock(!!this.data.locked);
		if (this.readonly) this.freezeInteractions();

		// Obsidian can render the code block while the container is briefly
		// 0-width (mode switches, collapsed sections, etc.), in which case
		// Leaflet only loads the single tile around the centre and never
		// recovers. Reflowing on resize fixes that.
		this.resizeObserver = new ResizeObserver(() => {
			this.map?.invalidateSize({ animate: false, pan: false });
		});
		this.resizeObserver.observe(this.wrapEl);
	}

	private freezeInteractions() {
		const m = this.map;
		m.dragging?.disable();
		m.scrollWheelZoom?.disable();
		m.doubleClickZoom?.disable();
		m.boxZoom?.disable();
		m.keyboard?.disable();
		m.touchZoom?.disable();
		this.mapEl.style.cursor = "default";
	}

	private async takeSnapshot() {
		if (this.erroredProviders.size > 0) {
			new Notice(
				`MapDraw: snapshot aborted — tile errors detected from "${[...this.erroredProviders].join(", ")}". Switch provider and try again.`
			);
			return;
		}
		this.clearSelection();
		this.mapEl.classList.add("mapdraw-capturing");
		try {
			new Notice("MapDraw: capturing snapshot…");
			// Wait one frame so the capture-mode CSS hides controls before we render.
			await new Promise((r) => requestAnimationFrame(r));
			const dataUrl = await toPng(this.mapEl, {
				cacheBust: true,
				pixelRatio: window.devicePixelRatio || 1,
				skipFonts: true,
			});
			const bytes = dataUrlToBytes(dataUrl);
			const path = await snapshotPathFor(this.app, this.options.source, this.settings);
			await this.app.vault.adapter.writeBinary(path, bytes.buffer.slice(0) as ArrayBuffer);
			this.data.snapshotPath = path;
			const fingerprint = JSON.stringify(this.data);
			await writeMapData(this.app, this.options.source, this.data);
			this.onPersisted?.(fingerprint);
			new Notice("MapDraw: snapshot saved");
			this.onSnapshotChange?.();
		} catch (err) {
			console.error("MapDraw snapshot failed:", err);
			new Notice("MapDraw: snapshot failed (see console). Tile CORS may be blocking capture.");
		} finally {
			this.mapEl.classList.remove("mapdraw-capturing");
		}
	}

	private applyLock(locked: boolean) {
		this.data.locked = locked;
		const m = this.map;
		const setEnabled = (handler: { enable: () => void; disable: () => void } | undefined, on: boolean) => {
			if (!handler) return;
			if (on) handler.enable(); else handler.disable();
		};
		setEnabled(m.dragging, !locked);
		setEnabled(m.scrollWheelZoom, !locked);
		setEnabled(m.doubleClickZoom, !locked);
		setEnabled(m.boxZoom, !locked);
		setEnabled(m.keyboard, !locked);
		setEnabled(m.touchZoom as unknown as { enable: () => void; disable: () => void }, !locked);
		// Hide / show our overlay zoom + toolbar by toggling the wrap class.
		this.wrapEl.classList.toggle("mapdraw-locked", locked);
		// In edit mode, also hide the toolbar and clear any selection.
		this.toolbar?.setVisible(!locked);
		if (locked) this.clearSelection();
		this.lockBtn?.toggleClass("mapdraw-lock-on", locked);
	}

	destroy() {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		try { this.map.remove(); } catch { /* ignore */ }
		this.toolbar?.destroy();
		this.stylePanel?.destroy();
		this.container.empty();
	}

	private shouldFitBounds(): boolean {
		return !this.data.view?.center && !this.data.view?.zoom && this.options.defaultZoom == null;
	}

	private fitToShapes() {
		const bounds = L.latLngBounds([]);
		for (const shape of this.data.shapes) extendBounds(bounds, shape);
		if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [20, 20] });
	}

	private applyProvider(id: string) {
		let resolved = resolveProvider(id, this.settings);
		let effectiveId = id;
		if (!resolved) {
			new Notice(`MapDraw: provider "${id}" no longer exists — falling back to default`);
			effectiveId = this.settings.defaultProvider;
			resolved = resolveProvider(effectiveId, this.settings);
			if (!resolved) return;
		}
		this.currentProviderId = effectiveId;
		if (this.tileLayer) {
			this.tileLayer.off();
			this.tileLayer.remove();
		}
		this.loadingCount = 0;
		this.updateLoadingIndicator();
		this.tileLayer = makeTileLayer(resolved);
		this.bindTileLoadingEvents(this.tileLayer, resolved.name);
		this.tileLayer.addTo(this.map);
		this.updateBanner(resolved.missingApiKey ? `Tile provider "${resolved.name}" needs an API key.` : null);
	}

	private applyOverlay(id: string) {
		const resolved = resolveProvider(id, this.settings);
		if (!resolved) return;
		this.currentOverlayId = id;
		if (this.overlayLayer) {
			this.overlayLayer.off();
			this.overlayLayer.remove();
		}
		this.overlayLayer = makeTileLayer(resolved, { opacity: 0.6 });
		this.bindTileLoadingEvents(this.overlayLayer, resolved.name);
		this.overlayLayer.addTo(this.map);
	}

	private bindTileLoadingEvents(layer: L.TileLayer, providerName: string) {
		layer.on("loading", () => {
			this.loadingCount++;
			this.updateLoadingIndicator();
		});
		const settle = () => {
			this.loadingCount = Math.max(0, this.loadingCount - 1);
			this.updateLoadingIndicator();
		};
		layer.on("load", settle);
		// `load` does not always fire when every tile errors; safety-net via `tileerror`.
		layer.on("tileerror", (e: L.TileErrorEvent) => {
			const key = providerName;
			if (!this.erroredProviders.has(key)) {
				this.erroredProviders.add(key);
				const url = (e as unknown as { tile?: HTMLImageElement }).tile?.src;
				console.warn(`MapDraw: tile error from "${providerName}". URL:`, url);
			}
		});
	}

	private updateLoadingIndicator() {
		if (this.loadingCount > 0) {
			if (!this.loadingEl) {
				this.loadingEl = this.overlayEl.createDiv({ cls: "mapdraw-loading" });
				this.loadingEl.createDiv({ cls: "mapdraw-spinner" });
				this.loadingEl.createSpan({ cls: "mapdraw-loading-label", text: "Loading tiles…" });
			}
		} else if (this.loadingEl) {
			this.loadingEl.remove();
			this.loadingEl = null;
		}
	}

	private updateBanner(msg: string | null) {
		if (!msg) {
			if (this.banner) {
				this.banner.remove();
				this.banner = null;
			}
			return;
		}
		if (!this.banner) {
			this.banner = this.overlayEl.createDiv({ cls: "mapdraw-banner" });
		}
		this.banner.empty();
		this.banner.createSpan({ text: msg + " " });
		const link = this.banner.createEl("a", { text: "Open settings" });
		link.onclick = () => {
			(this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting.open();
			(this.app as unknown as { setting: { openTabById(id: string): void } }).setting.openTabById("mapdraw");
		};
	}

	private buildControls() {
		// Top-left: our own zoom +/- (replaces Leaflet's default, which other
		// plugins sometimes hide via global CSS).
		const tl = this.overlayEl.createDiv({ cls: "mapdraw-control-tl" });
		this.makeButton(tl, "plus", "Zoom in", () => this.map.zoomIn());
		this.makeButton(tl, "minus", "Zoom out", () => this.map.zoomOut());
		L.DomEvent.disableClickPropagation(tl);
		L.DomEvent.disableScrollPropagation(tl);

		const tr = this.overlayEl.createDiv({ cls: "mapdraw-control-tr" });
		const dropdown = tr.createEl("select", { cls: "mapdraw-provider-select" });
		for (const p of listProviders(this.settings)) {
			const opt = dropdown.createEl("option", { value: p.id, text: p.name });
			if (p.id === this.currentProviderId) opt.selected = true;
		}
		dropdown.onchange = () => {
			this.applyProvider(dropdown.value);
		};
		L.DomEvent.disableClickPropagation(tr);

		const br = this.overlayEl.createDiv({ cls: "mapdraw-control-br" });
		this.makeButton(br, "locate-fixed", "Recenter", () => {
			if (this.data.shapes.length > 0) this.fitToShapes();
			else if (this.data.view?.center)
				this.map.setView(this.data.view.center as L.LatLngExpression, this.data.view.zoom ?? this.settings.defaultZoom);
			else
				this.map.setView(FALLBACK_CENTER as L.LatLngExpression, FALLBACK_ZOOM);
		});
		if (!this.readonly) {
			this.makeButton(br, "save", "Save view", () => {
				const c = this.map.getCenter();
				this.data.view = {
					center: [c.lat, c.lng],
					zoom: this.map.getZoom(),
					provider: this.currentProviderId,
					overlay: this.currentOverlayId || undefined,
				};
				this.save();
				new Notice("MapDraw: view saved");
			});
			this.makeButton(br, "camera", "Snapshot map", () => { void this.takeSnapshot(); });
			this.lockBtn = this.makeButton(br, this.data.locked ? "lock" : "unlock", "Lock map", () => {
				const next = !this.data.locked;
				this.applyLock(next);
				setIcon(this.lockBtn!, next ? "lock" : "unlock");
				this.lockBtn!.title = next ? "Unlock map" : "Lock map";
				this.lockBtn!.toggleClass("mapdraw-lock-on", next);
				this.save();
			});
			if (this.data.locked) this.lockBtn.addClass("mapdraw-lock-on");
		}
		L.DomEvent.disableClickPropagation(br);

		const bl = this.overlayEl.createDiv({ cls: "mapdraw-control-bl" });
		this.coordEl = bl.createSpan({ cls: "mapdraw-coords", text: "" });
		this.coordEl.title = "Click to copy";
		this.coordEl.onclick = async () => {
			if (!this.coordEl?.textContent) return;
			try {
				await navigator.clipboard.writeText(this.coordEl.textContent);
				new Notice("Coordinates copied");
			} catch {
				new Notice("Copy failed");
			}
		};
		this.map.on("mousemove", (e: L.LeafletMouseEvent) => {
			if (this.coordEl) this.coordEl.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
		});
		L.DomEvent.disableClickPropagation(bl);
	}

	private makeButton(parent: HTMLElement, icon: string, title: string, onClick: () => void): HTMLButtonElement {
		const btn = parent.createEl("button", { cls: "mapdraw-btn" });
		btn.title = title;
		btn.setAttr("aria-label", title);
		setIcon(btn, icon);
		btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
		return btn;
	}

	private renderShapes() {
		for (const shape of this.data.shapes) this.addLayerForShape(shape);
	}

	private addLayerForShape(shape: Shape) {
		const layer = this.buildLayer(shape);
		if (!layer) return;
		this.layers.set(shape.id, layer);
		layer.addTo(this.map);
		this.bindShapeInteractions(shape, layer);
	}

	private buildLayer(shape: Shape): L.Layer | null {
		const style = pathStyle(shape.style);
		switch (shape.type) {
			case "marker": {
				const m = L.marker(shape.position as L.LatLngExpression);
				if (shape.label) m.bindTooltip(shape.label);
				return m;
			}
			case "line":
				return L.polyline(shape.points as L.LatLngExpression[], style);
			case "polygon":
				return L.polygon(shape.points as L.LatLngExpression[], style);
			case "rectangle":
				return L.rectangle(shape.bounds as unknown as L.LatLngBoundsExpression, style);
			case "circle":
				return L.circle(shape.center as L.LatLngExpression, { ...style, radius: shape.radius });
			case "freehand": {
				if (shape.closed) return L.polygon(shape.points as L.LatLngExpression[], style);
				return L.polyline(shape.points as L.LatLngExpression[], style);
			}
			case "text":
				return createTextMarker(shape);
		}
	}

	private bindShapeInteractions(shape: Shape, layer: L.Layer) {
		layer.on("click", (e: L.LeafletMouseEvent) => {
			L.DomEvent.stopPropagation(e);
			if (shape.type === "marker" && shape.notePath) {
				this.app.workspace.openLinkText(shape.notePath, this.sourcePath);
				return;
			}
			if (!this.readonly && !this.data.locked) this.selectShape(shape.id);
		});
		if (shape.type === "marker" && shape.notePath) {
			const path = shape.notePath;
			const el = (layer as L.Marker).getElement();
			if (el) {
				el.addEventListener("mouseover", (ev) => {
					this.app.workspace.trigger("hover-link", {
						event: ev,
						source: "mapdraw",
						hoverParent: this.container,
						targetEl: el,
						linktext: path,
						sourcePath: this.sourcePath,
					});
				});
			}
		}
	}

	private addShape(shape: Shape) {
		this.data.shapes.push(shape);
		this.addLayerForShape(shape);
		this.save();
		if (shape.type === "marker") {
			this.promptMarkerLink(shape.id);
		} else if (shape.type === "text") {
			// Already prompted by DrawTools.
		}
	}

	private promptMarkerLink(shapeId: string) {
		const shape = this.findShape(shapeId);
		if (!shape || shape.type !== "marker") return;
		new NoteLinkSuggester(this.app, {
			allowClear: true,
			onPick: (file) => {
				if (file) shape.notePath = file.path;
				this.replaceShapeLayer(shape);
				this.save();
			},
		}).open();
	}

	private findShape(id: string): Shape | null {
		return this.data.shapes.find((s) => s.id === id) ?? null;
	}

	private selectShape(id: string) {
		this.clearSelection();
		this.selectedId = id;
		const shape = this.findShape(id);
		if (!shape) return;
		const layer = this.layers.get(id);
		if (layer && "setStyle" in layer) {
			(layer as L.Path).setStyle({ dashArray: "4 4" });
		}
		this.spawnEditHandles(shape);
		this.stylePanel?.show(shape);
	}

	private clearSelection() {
		if (this.selectedId) {
			const layer = this.layers.get(this.selectedId);
			if (layer && "setStyle" in layer) {
				const shape = this.findShape(this.selectedId);
				if (shape) (layer as L.Path).setStyle({ ...pathStyle(shape.style), dashArray: "" });
			}
		}
		for (const h of this.editHandles) h.remove();
		this.editHandles = [];
		this.selectedId = null;
		this.stylePanel?.hide();
	}

	private spawnEditHandles(shape: Shape) {
		if (this.readonly) return;
		switch (shape.type) {
			case "marker":
			case "text": {
				const m = this.layers.get(shape.id) as L.Marker;
				m.dragging?.enable();
				m.on("dragend", () => {
					const ll = m.getLatLng();
					if (shape.type === "marker") shape.position = [ll.lat, ll.lng];
					if (shape.type === "text") shape.position = [ll.lat, ll.lng];
					this.save();
				});
				break;
			}
			case "line":
			case "polygon":
			case "freehand": {
				shape.points.forEach((pt, idx) => {
					const handle = this.makeVertexHandle(pt, (newPt) => {
						shape.points[idx] = newPt;
						this.refreshShapeGeometry(shape);
						this.save();
					});
					this.editHandles.push(handle);
				});
				break;
			}
			case "rectangle": {
				const corners: LatLng[] = [shape.bounds[0], shape.bounds[1]];
				corners.forEach((pt, idx) => {
					const handle = this.makeVertexHandle(pt, (newPt) => {
						shape.bounds[idx] = newPt;
						this.refreshShapeGeometry(shape);
						this.save();
					});
					this.editHandles.push(handle);
				});
				break;
			}
			case "circle": {
				const centerHandle = this.makeVertexHandle(shape.center, (newPt) => {
					shape.center = newPt;
					this.refreshShapeGeometry(shape);
					this.save();
				});
				this.editHandles.push(centerHandle);
				const radiusPoint = computeRadiusHandlePoint(shape.center, shape.radius);
				const radiusHandle = this.makeVertexHandle(radiusPoint, (newPt) => {
					const layer = this.layers.get(shape.id) as L.Circle;
					const c = L.latLng(shape.center as L.LatLngExpression);
					const r = c.distanceTo(L.latLng(newPt as L.LatLngExpression));
					shape.radius = r;
					layer.setRadius(r);
					this.save();
				});
				this.editHandles.push(radiusHandle);
				break;
			}
		}
	}

	private makeVertexHandle(pt: LatLng, onMove: (newPt: LatLng) => void): L.Marker {
		const handle = L.marker(pt as L.LatLngExpression, {
			draggable: true,
			icon: L.divIcon({ className: "mapdraw-vertex-handle", iconSize: [10, 10] }),
		});
		handle.on("drag", () => {
			const ll = handle.getLatLng();
			onMove([ll.lat, ll.lng]);
		});
		handle.addTo(this.map);
		return handle;
	}

	private refreshShapeGeometry(shape: Shape) {
		const layer = this.layers.get(shape.id);
		if (!layer) return;
		switch (shape.type) {
			case "line":
			case "freehand":
				(layer as L.Polyline).setLatLngs(shape.points as L.LatLngExpression[]);
				break;
			case "polygon":
				(layer as L.Polygon).setLatLngs(shape.points as L.LatLngExpression[]);
				break;
			case "rectangle":
				(layer as L.Rectangle).setBounds(shape.bounds as unknown as L.LatLngBoundsExpression);
				break;
			case "circle":
				(layer as L.Circle).setLatLng(shape.center as L.LatLngExpression);
				break;
		}
	}

	private replaceShapeLayer(shape: Shape) {
		const old = this.layers.get(shape.id);
		if (old) old.remove();
		this.addLayerForShape(shape);
	}

	private onShapeStyleChanged(shape: Shape) {
		const layer = this.layers.get(shape.id);
		if (!layer) return;
		const style = pathStyle(shape.style);
		if ("setStyle" in layer) (layer as L.Path).setStyle({ ...style, dashArray: this.selectedId === shape.id ? "4 4" : "" });
		if (shape.type === "text") updateTextMarker(layer as L.Marker, shape);
		if (shape.type === "marker") {
			(layer as L.Marker).unbindTooltip();
			if (shape.label) (layer as L.Marker).bindTooltip(shape.label);
		}
		this.save();
	}

	private deleteShape(id: string) {
		const idx = this.data.shapes.findIndex((s) => s.id === id);
		if (idx < 0) return;
		this.data.shapes.splice(idx, 1);
		const layer = this.layers.get(id);
		layer?.remove();
		this.layers.delete(id);
		this.clearSelection();
		this.save();
	}

	private onKey = (e: KeyboardEvent) => {
		if (this.readonly) return;
		if (e.key === "Delete" || e.key === "Backspace") {
			if (this.selectedId) {
				e.preventDefault();
				this.deleteShape(this.selectedId);
			}
		}
		if (e.key === "Escape") {
			this.clearSelection();
		}
	};
}

// Fallback view for fresh maps when no geolocation / saved view / shapes exist.
const FALLBACK_CENTER: LatLng = [48.8584, 2.2945]; // Eiffel Tower
const FALLBACK_ZOOM = 14;

function makeTileLayer(resolved: ResolvedProvider, extra: L.TileLayerOptions = {}): L.TileLayer {
	// crossOrigin lets html-to-image read the tile pixels for snapshot capture.
	// Servers that don't return CORS headers will simply produce blank tiles in
	// the snapshot but render normally on screen.
	const common: L.TileLayerOptions = { crossOrigin: "" };
	if (resolved.type === "wms") {
		return L.tileLayer.wms(resolved.url, {
			layers: resolved.layers ?? "0",
			format: resolved.format ?? "image/png",
			transparent: true,
			attribution: resolved.attribution,
			maxZoom: resolved.maxZoom,
			...common,
			...extra,
		} as L.WMSOptions);
	}
	return L.tileLayer(resolved.url, {
		attribution: resolved.attribution,
		maxZoom: resolved.maxZoom,
		subdomains: resolved.subdomains ?? "abc",
		...common,
		...extra,
	});
}

export async function snapshotPathFor(
	app: App,
	sourcePath: string,
	settings: MapDrawSettings
): Promise<string> {
	const slash = sourcePath.lastIndexOf("/");
	const sourceDir = slash > 0 ? sourcePath.slice(0, slash) : "";
	const fileName = slash >= 0 ? sourcePath.slice(slash + 1) : sourcePath;
	const baseName = fileName.replace(/\.json$/i, "");
	const snapshotName = `${baseName}.snapshot.png`;

	let folder: string;
	if (settings.snapshotLocation === "attachment") {
		folder = await resolveAttachmentFolder(app, sourcePath, snapshotName);
	} else if (settings.snapshotLocation === "custom") {
		folder = settings.snapshotFolder.trim().replace(/^\/+|\/+$/g, "");
	} else {
		folder = sourceDir;
	}

	if (folder) {
		const exists = await app.vault.adapter.exists(folder);
		if (!exists) await app.vault.adapter.mkdir(folder);
		return `${folder}/${snapshotName}`;
	}
	return snapshotName;
}

async function resolveAttachmentFolder(app: App, sourcePath: string, fileName: string): Promise<string> {
	// Probe Obsidian's attachment-folder resolver with a name that won't exist,
	// then take the parent dir so we can write to a stable, deterministic path.
	const probeName = `__mapdraw_probe_${Date.now()}_${Math.random().toString(36).slice(2)}__${fileName}`;
	const sample = await app.fileManager.getAvailablePathForAttachment(probeName, sourcePath);
	const idx = sample.lastIndexOf("/");
	return idx > 0 ? sample.slice(0, idx) : "";
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
	const idx = dataUrl.indexOf(",");
	const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function pathStyle(s: Shape["style"]): L.PathOptions {
	return {
		color: s?.color ?? "#3388ff",
		weight: s?.weight ?? 3,
		opacity: s?.opacity ?? 1,
		fillColor: s?.fillColor,
		fillOpacity: s?.fillOpacity ?? 0.2,
	};
}

function extendBounds(bounds: L.LatLngBounds, shape: Shape) {
	switch (shape.type) {
		case "marker":
		case "text":
			bounds.extend(shape.position as L.LatLngExpression);
			break;
		case "line":
		case "polygon":
		case "freehand":
			for (const p of shape.points) bounds.extend(p as L.LatLngExpression);
			break;
		case "rectangle":
			bounds.extend(shape.bounds[0] as L.LatLngExpression).extend(shape.bounds[1] as L.LatLngExpression);
			break;
		case "circle": {
			const c = L.latLng(shape.center as L.LatLngExpression);
			bounds.extend(c.toBounds(shape.radius * 2));
			break;
		}
	}
}

function computeRadiusHandlePoint(center: LatLng, radiusMetres: number): LatLng {
	const c = L.latLng(center as L.LatLngExpression);
	const earth = 6378137;
	const dLng = (radiusMetres / (earth * Math.cos((c.lat * Math.PI) / 180))) * (180 / Math.PI);
	return [c.lat, c.lng + dLng];
}
