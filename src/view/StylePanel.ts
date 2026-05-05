import * as L from "leaflet";
import type { App } from "obsidian";
import type { Shape, ShapeStyle } from "../types";
import { NoteLinkSuggester } from "./NoteLinkSuggester";

export interface StylePanelOptions {
	app: App;
	host: HTMLElement;
	sourcePath: string;
	onChange: (shape: Shape) => void;
	onDelete: (shape: Shape) => void;
}

export class StylePanel {
	private opts: StylePanelOptions;
	private el: HTMLDivElement | null = null;
	private current: Shape | null = null;

	constructor(opts: StylePanelOptions) {
		this.opts = opts;
	}

	show(shape: Shape) {
		this.current = shape;
		if (!this.el) {
			this.el = this.opts.host.createDiv({ cls: "mapdraw-style-panel" });
			L.DomEvent.disableClickPropagation(this.el);
			L.DomEvent.disableScrollPropagation(this.el);
		}
		this.render();
	}

	hide() {
		this.current = null;
		this.el?.remove();
		this.el = null;
	}

	destroy() {
		this.hide();
	}

	private render() {
		if (!this.el || !this.current) return;
		this.el.empty();
		const shape = this.current;

		const header = this.el.createDiv({ cls: "mapdraw-style-header" });
		header.createSpan({ text: this.titleFor(shape) });

		const body = this.el.createDiv({ cls: "mapdraw-style-body" });

		// Label
		this.row(body, "Label", (parent) => {
			const input = parent.createEl("input", { type: "text" });
			input.value = shape.label ?? "";
			input.oninput = () => {
				shape.label = input.value || undefined;
				this.opts.onChange(shape);
			};
		});

		// Stroke for all path-style shapes (and text colour)
		if (shape.type !== "marker") {
			this.row(body, "Stroke", (parent) => {
				const c = parent.createEl("input", { type: "color" });
				c.value = shape.style?.color ?? "#3388ff";
				c.oninput = () => this.updateStyle(shape, { color: c.value });
			});
			if (shape.type !== "text") {
				this.row(body, "Weight", (parent) => {
					const r = parent.createEl("input", { type: "range" });
					r.min = "1"; r.max = "10"; r.step = "1";
					r.value = String(shape.style?.weight ?? 3);
					r.oninput = () => this.updateStyle(shape, { weight: Number(r.value) });
				});
				this.row(body, "Opacity", (parent) => {
					const r = parent.createEl("input", { type: "range" });
					r.min = "0"; r.max = "1"; r.step = "0.05";
					r.value = String(shape.style?.opacity ?? 1);
					r.oninput = () => this.updateStyle(shape, { opacity: Number(r.value) });
				});
			}
		}

		// Fill for closed shapes
		if (this.hasFill(shape)) {
			this.row(body, "Fill", (parent) => {
				const c = parent.createEl("input", { type: "color" });
				c.value = shape.style?.fillColor ?? shape.style?.color ?? "#3388ff";
				c.oninput = () => this.updateStyle(shape, { fillColor: c.value });
			});
			this.row(body, "Fill opacity", (parent) => {
				const r = parent.createEl("input", { type: "range" });
				r.min = "0"; r.max = "1"; r.step = "0.05";
				r.value = String(shape.style?.fillOpacity ?? 0.2);
				r.oninput = () => this.updateStyle(shape, { fillOpacity: Number(r.value) });
			});
		}

		// Marker icon
		if (shape.type === "marker") {
			this.row(body, "Icon (Lucide)", (parent) => {
				const input = parent.createEl("input", { type: "text" });
				input.placeholder = "map-pin";
				input.value = shape.icon ?? "";
				input.oninput = () => {
					shape.icon = input.value || undefined;
					this.opts.onChange(shape);
				};
			});
		}

		// Text size
		if (shape.type === "text") {
			this.row(body, "Font size", (parent) => {
				const input = parent.createEl("input", { type: "number" });
				input.value = String(shape.fontSize ?? 14);
				input.min = "8"; input.max = "72"; input.step = "1";
				input.oninput = () => {
					shape.fontSize = Number(input.value);
					this.opts.onChange(shape);
				};
			});
			this.row(body, "Text", (parent) => {
				const input = parent.createEl("input", { type: "text" });
				input.value = shape.text;
				input.oninput = () => {
					shape.text = input.value;
					this.opts.onChange(shape);
				};
			});
		}

		// Marker note link
		if (shape.type === "marker") {
			this.row(body, "Note link", (parent) => {
				const display = parent.createSpan({ cls: "mapdraw-link-display", text: shape.notePath ?? "(none)" });
				const pickBtn = parent.createEl("button", { text: "Pick…" });
				pickBtn.onclick = () => {
					new NoteLinkSuggester(this.opts.app, {
						allowClear: true,
						onPick: (file) => {
							shape.notePath = file?.path;
							display.textContent = shape.notePath ?? "(none)";
							this.opts.onChange(shape);
						},
					}).open();
				};
				if (shape.notePath) {
					const clearBtn = parent.createEl("button", { text: "Clear" });
					clearBtn.onclick = () => {
						shape.notePath = undefined;
						display.textContent = "(none)";
						this.opts.onChange(shape);
					};
				}
			});
		}

		// Delete
		const footer = this.el.createDiv({ cls: "mapdraw-style-footer" });
		const del = footer.createEl("button", { text: "Delete shape", cls: "mod-warning" });
		del.onclick = () => this.opts.onDelete(shape);
	}

	private titleFor(shape: Shape): string {
		switch (shape.type) {
			case "marker": return "Marker";
			case "line": return "Line";
			case "polygon": return "Polygon";
			case "rectangle": return "Rectangle";
			case "circle": return "Circle";
			case "freehand": return "Freehand";
			case "text": return "Text";
		}
	}

	private hasFill(shape: Shape): boolean {
		return shape.type === "polygon" || shape.type === "rectangle" || shape.type === "circle"
			|| (shape.type === "freehand" && !!shape.closed);
	}

	private row(parent: HTMLElement, label: string, build: (host: HTMLElement) => void) {
		const row = parent.createDiv({ cls: "mapdraw-style-row" });
		row.createSpan({ cls: "mapdraw-style-label", text: label });
		const host = row.createDiv({ cls: "mapdraw-style-control" });
		build(host);
	}

	private updateStyle(shape: Shape, patch: Partial<ShapeStyle>) {
		shape.style = { ...(shape.style ?? {}), ...patch };
		this.opts.onChange(shape);
	}
}
