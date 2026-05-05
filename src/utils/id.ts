export function newId(prefix = "s"): string {
	const rand = Math.random().toString(36).slice(2, 9);
	return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
