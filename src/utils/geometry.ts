import type { LatLng } from "../types";

export function distancePointToLine(p: [number, number], a: [number, number], b: [number, number]): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	if (dx === 0 && dy === 0) {
		const ex = p[0] - a[0];
		const ey = p[1] - a[1];
		return Math.sqrt(ex * ex + ey * ey);
	}
	const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
	const tc = Math.max(0, Math.min(1, t));
	const cx = a[0] + tc * dx;
	const cy = a[1] + tc * dy;
	const ex = p[0] - cx;
	const ey = p[1] - cy;
	return Math.sqrt(ex * ex + ey * ey);
}

export function douglasPeucker(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
	if (points.length < 3) return points.slice();
	let maxDist = 0;
	let index = 0;
	const last = points.length - 1;
	for (let i = 1; i < last; i++) {
		const d = distancePointToLine(points[i], points[0], points[last]);
		if (d > maxDist) {
			maxDist = d;
			index = i;
		}
	}
	if (maxDist > tolerance) {
		const left = douglasPeucker(points.slice(0, index + 1), tolerance);
		const right = douglasPeucker(points.slice(index), tolerance);
		return left.slice(0, -1).concat(right);
	}
	return [points[0], points[last]];
}

export function haversineMetres(a: LatLng, b: LatLng): number {
	const R = 6371000;
	const toRad = (x: number) => (x * Math.PI) / 180;
	const dLat = toRad(b[0] - a[0]);
	const dLng = toRad(b[1] - a[1]);
	const lat1 = toRad(a[0]);
	const lat2 = toRad(b[0]);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

export function pathLengthMetres(points: LatLng[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += haversineMetres(points[i - 1], points[i]);
	return total;
}

export function polygonAreaSqMetres(points: LatLng[]): number {
	if (points.length < 3) return 0;
	const R = 6378137;
	let area = 0;
	for (let i = 0; i < points.length; i++) {
		const [lat1, lng1] = points[i];
		const [lat2, lng2] = points[(i + 1) % points.length];
		area += ((lng2 - lng1) * Math.PI) / 180 * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
	}
	return Math.abs((area * R * R) / 2);
}
