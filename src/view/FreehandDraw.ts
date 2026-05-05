import * as L from "leaflet";
import { douglasPeucker } from "../utils/geometry";
import type { LatLng } from "../types";

export interface FreehandHandlerOptions {
	onComplete: (latlngs: LatLng[]) => void;
	onCancel?: () => void;
	tolerancePx?: number;
	style?: L.PathOptions;
}

export class FreehandHandler {
	private map: L.Map;
	private opts: FreehandHandlerOptions;
	private polyline: L.Polyline | null = null;
	private screenPoints: Array<[number, number]> = [];
	private latlngs: LatLng[] = [];
	private active = false;
	private origDragging = true;

	constructor(map: L.Map, opts: FreehandHandlerOptions) {
		this.map = map;
		this.opts = opts;
	}

	enable() {
		this.active = false;
		this.origDragging = this.map.dragging.enabled();
		this.map.getContainer().style.cursor = "crosshair";
		this.map.on("mousedown", this.onDown, this);
		this.map.on("mousemove", this.onMove, this);
		this.map.on("mouseup", this.onUp, this);
		document.addEventListener("keydown", this.onKey);
	}

	disable() {
		this.map.getContainer().style.cursor = "";
		this.map.off("mousedown", this.onDown, this);
		this.map.off("mousemove", this.onMove, this);
		this.map.off("mouseup", this.onUp, this);
		document.removeEventListener("keydown", this.onKey);
		if (this.polyline) {
			this.polyline.remove();
			this.polyline = null;
		}
		if (!this.origDragging) this.map.dragging.disable();
		else this.map.dragging.enable();
		this.active = false;
		this.screenPoints = [];
		this.latlngs = [];
	}

	private onDown(e: L.LeafletMouseEvent) {
		this.active = true;
		this.map.dragging.disable();
		this.screenPoints = [[e.containerPoint.x, e.containerPoint.y]];
		this.latlngs = [[e.latlng.lat, e.latlng.lng]];
		this.polyline = L.polyline(this.latlngs as L.LatLngExpression[], this.opts.style ?? { color: "#3388ff", weight: 3 });
		this.polyline.addTo(this.map);
	}

	private onMove(e: L.LeafletMouseEvent) {
		if (!this.active || !this.polyline) return;
		const last = this.screenPoints[this.screenPoints.length - 1];
		const dx = e.containerPoint.x - last[0];
		const dy = e.containerPoint.y - last[1];
		if (dx * dx + dy * dy < 4) return;
		this.screenPoints.push([e.containerPoint.x, e.containerPoint.y]);
		this.latlngs.push([e.latlng.lat, e.latlng.lng]);
		this.polyline.setLatLngs(this.latlngs as L.LatLngExpression[]);
	}

	private onUp() {
		if (!this.active) return;
		this.active = false;
		const tolerance = this.opts.tolerancePx ?? 3;
		const simplifiedScreen = douglasPeucker(this.screenPoints, tolerance);
		const simplified: LatLng[] = simplifiedScreen.map(
			(p) => {
				const ll = this.map.containerPointToLatLng(L.point(p[0], p[1]));
				return [ll.lat, ll.lng] as LatLng;
			}
		);
		if (this.polyline) {
			this.polyline.remove();
			this.polyline = null;
		}
		this.opts.onComplete(simplified);
	}

	private onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape" && this.opts.onCancel) {
			this.opts.onCancel();
		}
	};
}
