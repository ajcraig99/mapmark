import * as L from "leaflet";
import type { TextShape } from "../types";

export function createTextMarker(shape: TextShape): L.Marker {
	const html = document.createElement("div");
	html.className = "mapdraw-text-label";
	html.textContent = shape.text;
	const fontSize = shape.fontSize ?? 14;
	html.style.fontSize = `${fontSize}px`;
	if (shape.style?.color) html.style.color = shape.style.color;
	const icon = L.divIcon({
		html: html.outerHTML,
		className: "mapdraw-text-divicon",
		iconAnchor: [0, 0],
	});
	return L.marker(shape.position, { icon, draggable: false, interactive: true, keyboard: false });
}

export function updateTextMarker(marker: L.Marker, shape: TextShape) {
	const html = document.createElement("div");
	html.className = "mapdraw-text-label";
	html.textContent = shape.text;
	const fontSize = shape.fontSize ?? 14;
	html.style.fontSize = `${fontSize}px`;
	if (shape.style?.color) html.style.color = shape.style.color;
	const icon = L.divIcon({
		html: html.outerHTML,
		className: "mapdraw-text-divicon",
		iconAnchor: [0, 0],
	});
	marker.setIcon(icon);
	marker.setLatLng(shape.position);
}
