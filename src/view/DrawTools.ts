import * as L from "leaflet";
import { App, Modal, Setting, setIcon } from "obsidian";
import type {
	CircleShape,
	FreehandShape,
	LatLng,
	LineShape,
	MapMarkSettings,
	MarkerShape,
	PolygonShape,
	RectangleShape,
	Shape,
	TextShape,
} from "../types";
import { newId } from "../utils/id";
import { FreehandHandler } from "./FreehandDraw";

export type ToolId =
	| "select"
	| "marker"
	| "line"
	| "polygon"
	| "rectangle"
	| "circle"
	| "freehand"
	| "text";

export interface DrawToolsOptions {
	app: App;
	map: L.Map;
	host: HTMLElement;
	sourcePath: string;
	onShape: (shape: Shape) => void;
	getSettings: () => MapMarkSettings;
}

interface ToolDef {
	id: ToolId;
	icon: string;
	label: string;
}

const TOOLS: ToolDef[] = [
	{ id: "select", icon: "hand", label: "Select / pan" },
	{ id: "marker", icon: "map-pin", label: "Marker" },
	{ id: "line", icon: "minus", label: "Line" },
	{ id: "polygon", icon: "pentagon", label: "Polygon" },
	{ id: "rectangle", icon: "square", label: "Rectangle" },
	{ id: "circle", icon: "circle", label: "Circle" },
	{ id: "freehand", icon: "spline", label: "Freehand" },
	{ id: "text", icon: "type", label: "Text" },
];

export class DrawTools {
	private opts: DrawToolsOptions;
	private toolbar!: HTMLDivElement;
	private buttons = new Map<ToolId, HTMLButtonElement>();
	private active: ToolId = "select";
	private cleanup: Array<() => void> = [];

	constructor(opts: DrawToolsOptions) {
		this.opts = opts;
	}

	mount() {
		this.toolbar = this.opts.host.createDiv({ cls: "mapmark-toolbar" });
		L.DomEvent.disableClickPropagation(this.toolbar);
		L.DomEvent.disableScrollPropagation(this.toolbar);
		for (const t of TOOLS) {
			const btn = this.toolbar.createEl("button", { cls: "mapmark-tool-btn" });
			btn.title = t.label;
			btn.setAttr("aria-label", t.label);
			setIcon(btn, t.icon);
			btn.onclick = (e) => { e.preventDefault(); this.setTool(t.id); };
			this.buttons.set(t.id, btn);
		}
		this.setTool("select");
	}

	destroy() {
		this.deactivate();
		this.toolbar?.remove();
	}

	setVisible(visible: boolean) {
		if (!this.toolbar) return;
		this.toolbar.toggleClass("mapmark-hidden", !visible);
		if (!visible) {
			this.deactivate();
			this.active = "select";
			for (const [tid, btn] of this.buttons) btn.toggleClass("is-active", tid === "select");
		}
	}

	private setTool(id: ToolId) {
		this.deactivate();
		this.active = id;
		for (const [tid, btn] of this.buttons) {
			btn.toggleClass("is-active", tid === id);
		}
		switch (id) {
			case "select":
				break;
			case "marker":
				this.activateMarker();
				break;
			case "line":
				this.activateLineLike("line");
				break;
			case "polygon":
				this.activateLineLike("polygon");
				break;
			case "rectangle":
				this.activateRectangle();
				break;
			case "circle":
				this.activateCircle();
				break;
			case "freehand":
				this.activateFreehand();
				break;
			case "text":
				this.activateText();
				break;
		}
	}

	private deactivate() {
		for (const fn of this.cleanup) fn();
		this.cleanup = [];
		this.opts.map.getContainer().removeClass("mapmark-crosshair");
	}

	private addCleanup(fn: () => void) { this.cleanup.push(fn); }

	private activateMarker() {
		this.opts.map.getContainer().addClass("mapmark-crosshair");
		const handler = (e: L.LeafletMouseEvent) => {
			const shape: MarkerShape = {
				id: newId("m"),
				type: "marker",
				position: [e.latlng.lat, e.latlng.lng],
				createdAt: Date.now(),
			};
			this.opts.onShape(shape);
			this.setTool("select");
		};
		this.opts.map.on("click", handler);
		this.addCleanup(() => this.opts.map.off("click", handler));
	}

	private activateLineLike(kind: "line" | "polygon") {
		this.opts.map.getContainer().addClass("mapmark-crosshair");
		const points: LatLng[] = [];
		const preview = L.polyline([], { color: "#3388ff", weight: 3, dashArray: "4 4" }).addTo(this.opts.map);

		const refresh = () => {
			preview.setLatLngs(points as L.LatLngExpression[]);
		};

		const click = (e: L.LeafletMouseEvent) => {
			points.push([e.latlng.lat, e.latlng.lng]);
			refresh();
		};
		const dblclick = () => commit();
		const keydown = (ev: KeyboardEvent) => {
			if (ev.key === "Enter") commit();
			else if (ev.key === "Escape") cancel();
		};

		const commit = () => {
			if (points.length < 2) return cancel();
			if (kind === "line") {
				const shape: LineShape = { id: newId("l"), type: "line", points: points.slice(), createdAt: Date.now() };
				this.opts.onShape(shape);
			} else {
				const shape: PolygonShape = { id: newId("p"), type: "polygon", points: points.slice(), createdAt: Date.now() };
				this.opts.onShape(shape);
			}
			cleanup();
			this.setTool("select");
		};

		const cancel = () => {
			cleanup();
			this.setTool("select");
		};

		const cleanup = () => {
			preview.remove();
			this.opts.map.off("click", click);
			this.opts.map.off("dblclick", dblclick);
			document.removeEventListener("keydown", keydown);
		};

		this.opts.map.on("click", click);
		this.opts.map.on("dblclick", dblclick);
		document.addEventListener("keydown", keydown);
		this.addCleanup(cleanup);
	}

	private activateRectangle() {
		this.opts.map.getContainer().addClass("mapmark-crosshair");
		this.opts.map.dragging.disable();
		let start: LatLng | null = null;
		let preview: L.Rectangle | null = null;

		const onDown = (e: L.LeafletMouseEvent) => {
			start = [e.latlng.lat, e.latlng.lng];
			preview = L.rectangle(L.latLngBounds(e.latlng, e.latlng), { color: "#3388ff", weight: 2, dashArray: "4 4" }).addTo(this.opts.map);
		};
		const onMove = (e: L.LeafletMouseEvent) => {
			if (!start || !preview) return;
			preview.setBounds(L.latLngBounds(L.latLng(start as L.LatLngExpression), e.latlng));
		};
		const onUp = (e: L.LeafletMouseEvent) => {
			if (!start) return;
			const sw: LatLng = [Math.min(start[0], e.latlng.lat), Math.min(start[1], e.latlng.lng)];
			const ne: LatLng = [Math.max(start[0], e.latlng.lat), Math.max(start[1], e.latlng.lng)];
			preview?.remove();
			const shape: RectangleShape = { id: newId("r"), type: "rectangle", bounds: [sw, ne], createdAt: Date.now() };
			this.opts.onShape(shape);
			cleanup();
			this.setTool("select");
		};

		const cleanup = () => {
			this.opts.map.off("mousedown", onDown);
			this.opts.map.off("mousemove", onMove);
			this.opts.map.off("mouseup", onUp);
			this.opts.map.dragging.enable();
		};
		this.opts.map.on("mousedown", onDown);
		this.opts.map.on("mousemove", onMove);
		this.opts.map.on("mouseup", onUp);
		this.addCleanup(cleanup);
	}

	private activateCircle() {
		this.opts.map.getContainer().addClass("mapmark-crosshair");
		this.opts.map.dragging.disable();
		let center: L.LatLng | null = null;
		let preview: L.Circle | null = null;

		const onDown = (e: L.LeafletMouseEvent) => {
			center = e.latlng;
			preview = L.circle(center, { radius: 1, color: "#3388ff", weight: 2, dashArray: "4 4" }).addTo(this.opts.map);
		};
		const onMove = (e: L.LeafletMouseEvent) => {
			if (!center || !preview) return;
			preview.setRadius(center.distanceTo(e.latlng));
		};
		const onUp = (e: L.LeafletMouseEvent) => {
			if (!center) return;
			const radius = center.distanceTo(e.latlng);
			preview?.remove();
			const shape: CircleShape = {
				id: newId("c"),
				type: "circle",
				center: [center.lat, center.lng],
				radius,
				createdAt: Date.now(),
			};
			this.opts.onShape(shape);
			cleanup();
			this.setTool("select");
		};

		const cleanup = () => {
			this.opts.map.off("mousedown", onDown);
			this.opts.map.off("mousemove", onMove);
			this.opts.map.off("mouseup", onUp);
			this.opts.map.dragging.enable();
		};
		this.opts.map.on("mousedown", onDown);
		this.opts.map.on("mousemove", onMove);
		this.opts.map.on("mouseup", onUp);
		this.addCleanup(cleanup);
	}

	private activateFreehand() {
		const handler = new FreehandHandler(this.opts.map, {
			tolerancePx: 3,
			onComplete: (latlngs) => {
				if (latlngs.length >= 2) {
					const shape: FreehandShape = {
						id: newId("f"),
						type: "freehand",
						points: latlngs,
						createdAt: Date.now(),
					};
					this.opts.onShape(shape);
				}
				this.setTool("select");
			},
			onCancel: () => this.setTool("select"),
		});
		handler.enable();
		this.addCleanup(() => handler.disable());
	}

	private activateText() {
		this.opts.map.getContainer().addClass("mapmark-crosshair");
		const handler = (e: L.LeafletMouseEvent) => {
			const pos: LatLng = [e.latlng.lat, e.latlng.lng];
			new TextInputModal(this.opts.app, "", (value) => {
				if (!value) { this.setTool("select"); return; }
				const shape: TextShape = {
					id: newId("t"),
					type: "text",
					position: pos,
					text: value,
					createdAt: Date.now(),
				};
				this.opts.onShape(shape);
				this.setTool("select");
			}).open();
		};
		this.opts.map.on("click", handler);
		this.addCleanup(() => this.opts.map.off("click", handler));
	}
}

class TextInputModal extends Modal {
	private value: string;
	private onSubmit: (value: string) => void;

	constructor(app: App, initial: string, onSubmit: (value: string) => void) {
		super(app);
		this.value = initial;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		this.titleEl.setText("Text label");
		new Setting(this.contentEl).setName("Text").addText((t) => {
			t.setValue(this.value);
			t.onChange((v) => (this.value = v));
			t.inputEl.focus();
			t.inputEl.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") { ev.preventDefault(); this.submit(); }
			});
		});
		new Setting(this.contentEl).addButton((b) => {
			b.setButtonText("OK").setCta().onClick(() => this.submit());
		}).addButton((b) => {
			b.setButtonText("Cancel").onClick(() => this.close());
		});
	}

	private submit() {
		const v = this.value.trim();
		this.close();
		this.onSubmit(v);
	}
}
