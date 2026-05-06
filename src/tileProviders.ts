import type { CustomProvider, MapMarkSettings, TileProvider } from "./types";

export const BUILTIN_PROVIDERS: TileProvider[] = [
	{
		id: "opentopomap",
		name: "OpenTopoMap",
		url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
		attribution: "© OpenTopoMap (CC-BY-SA)",
		maxZoom: 17,
		subdomains: "abc",
		category: "map",
	},
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
		category: "map",
	},
	{
		id: "esri-topo",
		name: "Esri World Topo",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
		attribution: "Tiles © Esri & contributors",
		maxZoom: 19,
		category: "map",
	},
	{
		id: "esri-streets",
		name: "Esri World Street Map",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
		attribution: "Tiles © Esri",
		maxZoom: 19,
		category: "map",
	},
	{
		id: "esri-natgeo",
		name: "Esri National Geographic",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
		attribution: "Tiles © Esri & National Geographic",
		maxZoom: 16,
		category: "map",
	},
	{
		id: "esri-ocean",
		name: "Esri Ocean Basemap",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
		attribution: "Tiles © Esri",
		maxZoom: 13,
		category: "map",
	},
	{
		id: "esri-hillshade",
		name: "Esri World Hillshade",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
		attribution: "Tiles © Esri",
		maxZoom: 16,
		category: "map",
	},
	{
		id: "esri-imagery",
		name: "Esri World Imagery",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		attribution: "Tiles © Esri & contributors",
		maxZoom: 19,
		category: "satellite",
	},
	{
		id: "sentinel2-2024",
		name: "Sentinel-2 Cloudless 2024",
		url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
		attribution: "Sentinel-2 cloudless 2024 by EOX IT Services",
		maxZoom: 14,
		category: "satellite",
	},
	{
		id: "linz-aerial",
		name: "LINZ Aerial (NZ)",
		url: "https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api={api_key}",
		attribution: "© LINZ CC BY 4.0",
		maxZoom: 21,
		apiKeyField: "linzApiKey",
		category: "satellite",
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
		category: "satellite",
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

export function resolveProvider(id: string, settings: MapMarkSettings): ResolvedProvider | null {
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

export function listProviders(settings: MapMarkSettings): Array<{ id: string; name: string }> {
	const out: Array<{ id: string; name: string }> = BUILTIN_PROVIDERS.map((p) => ({ id: p.id, name: p.name }));
	for (const c of settings.customProviders) out.push({ id: c.id, name: c.name });
	return out;
}

export function populateProviderSelect(
	selectEl: HTMLSelectElement,
	settings: MapMarkSettings,
	currentId?: string,
): void {
	selectEl.empty();
	const groups: Array<{ label: string; entries: Array<{ id: string; name: string }> }> = [
		{ label: "Map", entries: [] },
		{ label: "Satellite", entries: [] },
		{ label: "Custom", entries: [] },
	];
	for (const p of BUILTIN_PROVIDERS) {
		const idx = p.category === "satellite" ? 1 : 0;
		groups[idx].entries.push({ id: p.id, name: p.name });
	}
	for (const c of settings.customProviders) {
		groups[2].entries.push({ id: c.id, name: c.name });
	}
	for (const g of groups) {
		if (g.entries.length === 0) continue;
		const og = selectEl.createEl("optgroup");
		og.label = g.label;
		for (const e of g.entries) {
			const opt = og.createEl("option", { value: e.id, text: e.name });
			if (e.id === currentId) opt.selected = true;
		}
	}
}

export function makeCustomProvider(): CustomProvider {
	return { id: "custom-" + Date.now().toString(36), name: "New provider", url: "", attribution: "", maxZoom: 19, apiKey: "" };
}
