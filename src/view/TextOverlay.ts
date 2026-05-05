import * as L from "leaflet";
import type { TextShape } from "../types";

export function createTextMarker(shape: TextShape): L.Marker {
	const html = buildLabelEl(shape);
	const icon = L.divIcon({
		html,
		className: "mapmark-text-divicon",
		iconAnchor: [0, 0],
	});
	return L.marker(shape.position, { icon, draggable: false, interactive: true, keyboard: false });
}

export function updateTextMarker(marker: L.Marker, shape: TextShape) {
	const html = buildLabelEl(shape);
	const icon = L.divIcon({
		html,
		className: "mapmark-text-divicon",
		iconAnchor: [0, 0],
	});
	marker.setIcon(icon);
	marker.setLatLng(shape.position);
}

function buildLabelEl(shape: TextShape): HTMLElement {
	const el = document.createElement("div");
	el.className = "mapmark-text-label";
	el.textContent = shape.text;
	// Inline: font size & colour are per-shape style, not class state.
	el.style.fontSize = `${shape.fontSize ?? 14}px`;
	if (shape.style?.color) el.style.color = shape.style.color;
	return el;
}
