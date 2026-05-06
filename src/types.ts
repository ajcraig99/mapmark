export type LatLng = [number, number];
export type Bounds = [LatLng, LatLng];

export interface ShapeStyle {
	color?: string;
	weight?: number;
	opacity?: number;
	fillColor?: string;
	fillOpacity?: number;
}

export interface BaseShape {
	id: string;
	type: ShapeType;
	style?: ShapeStyle;
	label?: string;
	notePath?: string;
	createdAt: number;
	groupId?: string;
}

export type ShapeType =
	| "marker"
	| "line"
	| "polygon"
	| "rectangle"
	| "circle"
	| "freehand"
	| "text";

export interface MarkerShape extends BaseShape {
	type: "marker";
	position: LatLng;
	icon?: string;
}

export interface LineShape extends BaseShape {
	type: "line";
	points: LatLng[];
}

export interface PolygonShape extends BaseShape {
	type: "polygon";
	points: LatLng[];
}

export interface FreehandShape extends BaseShape {
	type: "freehand";
	points: LatLng[];
	closed?: boolean;
}

export interface RectangleShape extends BaseShape {
	type: "rectangle";
	bounds: Bounds;
}

export interface CircleShape extends BaseShape {
	type: "circle";
	center: LatLng;
	radius: number;
}

export interface TextShape extends BaseShape {
	type: "text";
	position: LatLng;
	text: string;
	fontSize?: number;
}

export type Shape =
	| MarkerShape
	| LineShape
	| PolygonShape
	| FreehandShape
	| RectangleShape
	| CircleShape
	| TextShape;

export interface MapView {
	center?: LatLng;
	zoom?: number;
	provider?: string;
	overlay?: string;
}

export interface MapData {
	schemaVersion: 1;
	view?: MapView;
	locked?: boolean;
	snapshotPath?: string;
	shapes: Shape[];
}

export interface CodeBlockOptions {
	source: string;
	provider?: string;
	overlay?: string;
	height?: number;
	defaultZoom?: number;
}

export type ProviderType = "xyz" | "wms";

export interface TileProvider {
	id: string;
	name: string;
	url: string;
	attribution?: string;
	maxZoom?: number;
	subdomains?: string;
	apiKeyField?: keyof MapMarkSettings;
	apiKey?: string;
	type?: ProviderType;
	layers?: string;
	format?: string;
}

export interface CustomProvider {
	id: string;
	name: string;
	url: string;
	attribution?: string;
	maxZoom?: number;
	apiKey?: string;
	type?: ProviderType;
	layers?: string;
	format?: string;
}

export type SnapshotLocation = "next-to-map" | "custom" | "attachment";
export type SidecarLocation = "next-to-note" | "custom" | "attachment";
export type GeocoderProvider = "nominatim" | "mapbox";

export interface MapMarkSettings {
	defaultProvider: string;
	defaultZoom: number;
	defaultHeight: number;
	linzApiKey: string;
	customProviders: CustomProvider[];
	snapshotLocation: SnapshotLocation;
	snapshotFolder: string;
	sidecarLocation: SidecarLocation;
	sidecarFolder: string;
	geocoder: GeocoderProvider;
	mapboxApiKey: string;
}

export const DEFAULT_SETTINGS: MapMarkSettings = {
	defaultProvider: "opentopomap",
	defaultZoom: 13,
	defaultHeight: 480,
	linzApiKey: "",
	customProviders: [],
	snapshotLocation: "next-to-map",
	snapshotFolder: "",
	sidecarLocation: "next-to-note",
	sidecarFolder: "",
	geocoder: "nominatim",
	mapboxApiKey: "",
};

export function emptyMapData(): MapData {
	return { schemaVersion: 1, shapes: [] };
}
