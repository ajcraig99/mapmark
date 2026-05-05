import type { CustomProvider, MapDrawSettings, TileProvider } from "./types";

export const BUILTIN_PROVIDERS: TileProvider[] = [
	{
		// CartoDB Voyager is OpenStreetMap data rendered & hosted by CARTO.
		// We use it instead of tile.openstreetmap.org because OSM's tile usage
		// policy blocks Electron User-Agents (returns 200 OK with a 403 image),
		// which silently breaks every map and every snapshot.
		id: "carto-voyager",
		name: "CartoDB Voyager (OSM-style)",
		url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap contributors © CARTO",
		maxZoom: 19,
		subdomains: "abcd",
	},
	{
		id: "carto-positron",
		name: "CartoDB Positron (OSM-style, light)",
		url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap contributors © CARTO",
		maxZoom: 19,
		subdomains: "abcd",
	},
	{
		id: "esri-imagery",
		name: "Esri World Imagery",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		attribution: "Tiles © Esri & contributors",
		maxZoom: 19,
	},
	{
		id: "opentopomap",
		name: "OpenTopoMap",
		url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
		attribution: "© OpenTopoMap (CC-BY-SA)",
		maxZoom: 17,
		subdomains: "abc",
	},
	{
		id: "linz-aerial",
		name: "LINZ Aerial (NZ)",
		url: "https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api={api_key}",
		attribution: "© LINZ CC BY 4.0",
		maxZoom: 21,
		apiKeyField: "linzApiKey",
	},
	{
		id: "landgate-wa",
		name: "Landgate WA Aerial",
		url: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Locate/MapServer/WMSServer",
		attribution: "© Landgate / Government of Western Australia",
		maxZoom: 19,
		type: "wms",
		layers: "1",
		format: "image/png",
	},
];

export interface ResolvedProvider {
	id: string;
	name: string;
	url: string;
	attribution?: string;
	maxZoom: number;
	subdomains?: string;
	missingApiKey?: boolean;
	type: "xyz" | "wms";
	layers?: string;
	format?: string;
}

export function resolveProvider(id: string, settings: MapDrawSettings): ResolvedProvider | null {
	const builtin = BUILTIN_PROVIDERS.find((p) => p.id === id);
	if (builtin) {
		const apiKey = builtin.apiKeyField ? (settings[builtin.apiKeyField] as string) : "";
		const missingApiKey = !!builtin.apiKeyField && !apiKey;
		const url = builtin.apiKeyField ? builtin.url.replace("{api_key}", apiKey || "") : builtin.url;
		return {
			id: builtin.id,
			name: builtin.name,
			url,
			attribution: builtin.attribution,
			maxZoom: builtin.maxZoom ?? 19,
			subdomains: builtin.subdomains,
			missingApiKey,
			type: builtin.type ?? "xyz",
			layers: builtin.layers,
			format: builtin.format,
		};
	}
	const custom = settings.customProviders.find((p) => p.id === id);
	if (custom) {
		const url = custom.url.replace("{api_key}", custom.apiKey || "");
		return {
			id: custom.id,
			name: custom.name,
			url,
			attribution: custom.attribution,
			maxZoom: custom.maxZoom ?? 19,
			type: custom.type ?? "xyz",
			layers: custom.layers,
			format: custom.format,
		};
	}
	return null;
}

export function listProviders(settings: MapDrawSettings): Array<{ id: string; name: string }> {
	const out: Array<{ id: string; name: string }> = BUILTIN_PROVIDERS.map((p) => ({ id: p.id, name: p.name }));
	for (const c of settings.customProviders) out.push({ id: c.id, name: c.name });
	return out;
}

export function makeCustomProvider(): CustomProvider {
	return { id: "custom-" + Date.now().toString(36), name: "New provider", url: "", attribution: "", maxZoom: 19, apiKey: "" };
}
