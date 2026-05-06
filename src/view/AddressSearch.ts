import * as L from "leaflet";
import { Notice, setIcon } from "obsidian";
import type { MapMarkSettings } from "../types";

export interface AddressSearchOptions {
	map: L.Map;
	host: HTMLElement;
	getSettings: () => MapMarkSettings;
}

interface GeoHit {
	displayName: string;
	lat: number;
	lon: number;
	// [south, north, west, east] — matches Nominatim's order so we can use it
	// directly for L.latLngBounds.
	bbox?: [number, number, number, number];
	approximate: boolean;
}

interface NominatimResult {
	lat: string;
	lon: string;
	boundingbox: [string, string, string, string];
	display_name: string;
}

interface MapboxFeature {
	geometry: { type: "Point"; coordinates: [number, number] };
	properties: {
		full_address?: string;
		name?: string;
		bbox?: [number, number, number, number]; // [west, south, east, north]
	};
}

interface MapboxResponse {
	features: MapboxFeature[];
}

export class AddressSearch {
	private opts: AddressSearchOptions;
	private container!: HTMLDivElement;
	private button!: HTMLButtonElement;
	private input!: HTMLInputElement;
	private expanded = false;
	private outsideHandler: ((e: MouseEvent) => void) | null = null;
	private inFlight: AbortController | null = null;

	constructor(opts: AddressSearchOptions) {
		this.opts = opts;
	}

	mount() {
		this.container = this.opts.host.createDiv({ cls: "mapmark-search" });
		L.DomEvent.disableClickPropagation(this.container);
		L.DomEvent.disableScrollPropagation(this.container);

		this.button = this.container.createEl("button", { cls: "mapmark-search-btn" });
		this.button.title = "Search address";
		this.button.setAttr("aria-label", "Search address");
		setIcon(this.button, "search");
		this.button.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggle();
		};

		this.input = this.container.createEl("input", {
			cls: "mapmark-search-input",
			type: "text",
			attr: { placeholder: "Search address…", spellcheck: "false" },
		});
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); void this.run(); }
			else if (e.key === "Escape") { e.preventDefault(); this.collapse(); }
		});
	}

	destroy() {
		this.removeOutside();
		this.inFlight?.abort();
		this.container?.remove();
	}

	private toggle() {
		if (this.expanded) this.collapse();
		else this.expand();
	}

	private expand() {
		this.expanded = true;
		this.container.addClass("is-open");
		this.input.focus();
		this.input.select();
		// Defer attachment so the click that opened us doesn't immediately close us.
		this.outsideHandler = (e: MouseEvent) => {
			if (!this.container.contains(e.target as Node)) this.collapse();
		};
		setTimeout(() => {
			if (this.outsideHandler) document.addEventListener("mousedown", this.outsideHandler);
		}, 0);
	}

	private collapse() {
		this.expanded = false;
		this.container.removeClass("is-open");
		this.input.value = "";
		this.removeOutside();
	}

	private removeOutside() {
		if (this.outsideHandler) {
			document.removeEventListener("mousedown", this.outsideHandler);
			this.outsideHandler = null;
		}
	}

	private async run() {
		const query = this.input.value.trim();
		if (!query) return;
		this.inFlight?.abort();
		this.inFlight = new AbortController();
		this.container.addClass("is-loading");
		try {
			const settings = this.opts.getSettings();
			const useMapbox = settings.geocoder === "mapbox" && settings.mapboxApiKey.trim().length > 0;
			const hit = useMapbox
				? await geocodeMapbox(query, settings.mapboxApiKey.trim(), this.inFlight.signal)
				: await geocodeNominatim(query, this.inFlight.signal);
			if (!hit) {
				new Notice(`MapMark: no results for "${query}"`);
				return;
			}
			if (hit.bbox) {
				const [s, n, w, e] = hit.bbox;
				this.opts.map.flyToBounds(L.latLngBounds([s, w], [n, e]), { padding: [20, 20], maxZoom: 17 });
			} else {
				this.opts.map.flyTo([hit.lat, hit.lon], 16);
			}
			// Show the matched name when the result is approximate (Nominatim
			// fallback chain) so users notice when we land on the street rather
			// than the actual business they typed.
			if (hit.approximate) new Notice(`MapMark: matched "${hit.displayName}"`);
			this.collapse();
		} catch (err) {
			if ((err as { name?: string })?.name === "AbortError") return;
			console.error("MapMark address search failed:", err);
			new Notice("MapMark: address search failed (see console)");
		} finally {
			this.container.removeClass("is-loading");
			this.inFlight = null;
		}
	}
}

async function geocodeNominatim(query: string, signal: AbortSignal): Promise<GeoHit | null> {
	const candidates = buildNominatimFallbacks(query);
	for (const q of candidates) {
		const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
		const res = await fetch(url, { signal });
		if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
		const items = (await res.json()) as NominatimResult[];
		if (items.length > 0) {
			const r = items[0];
			const bb = r.boundingbox.map(parseFloat);
			return {
				displayName: r.display_name,
				lat: parseFloat(r.lat),
				lon: parseFloat(r.lon),
				bbox: bb.every(Number.isFinite) ? (bb as [number, number, number, number]) : undefined,
				approximate: q !== query,
			};
		}
	}
	return null;
}

async function geocodeMapbox(query: string, token: string, signal: AbortSignal): Promise<GeoHit | null> {
	const url =
		`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}` +
		`&limit=1&access_token=${encodeURIComponent(token)}`;
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`);
	const data = (await res.json()) as MapboxResponse;
	if (!data.features?.length) return null;
	const f = data.features[0];
	const [lon, lat] = f.geometry.coordinates;
	let bbox: GeoHit["bbox"];
	if (f.properties.bbox) {
		// Mapbox: [west, south, east, north] → our [south, north, west, east]
		const [w, s, e, n] = f.properties.bbox;
		bbox = [s, n, w, e];
	}
	return {
		displayName: f.properties.full_address || f.properties.name || query,
		lat,
		lon,
		bbox,
		approximate: false,
	};
}

function buildNominatimFallbacks(q: string): string[] {
	const out = [q];
	const parts = q.split(",").map((s) => s.trim()).filter(Boolean);
	// Try dropping the first chunk (often a POI/business name), then the first
	// two chunks (rare cases like "Business, Suite 4, address...").
	for (let i = 1; i < Math.min(parts.length, 3); i++) {
		const candidate = parts.slice(i).join(", ");
		if (candidate && candidate !== out[out.length - 1]) out.push(candidate);
	}
	return out;
}
