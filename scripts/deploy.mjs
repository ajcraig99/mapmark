import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const vault = process.env.MAPMARK_VAULT;
if (!vault) {
	console.error(
		"MAPMARK_VAULT is not set. Point it at your Obsidian vault root, e.g.:\n" +
			"  export MAPMARK_VAULT=\"$HOME/Documents/ObsidianVault\"",
	);
	process.exit(1);
}

// Accept either a vault root or a plugin folder; auto-extend to the plugin folder.
const target = (await isDir(join(vault, ".obsidian", "plugins", "mapmark")))
	? join(vault, ".obsidian", "plugins", "mapmark")
	: vault;

await mkdir(target, { recursive: true });

const files = ["main.js", "manifest.json", "styles.css"];
for (const f of files) {
	const src = join(root, f);
	const dst = join(target, f);
	await copyFile(src, dst);
	console.log(`copied ${f} -> ${dst}`);
}

async function isDir(p) {
	try {
		const s = await stat(p);
		return s.isDirectory();
	} catch {
		return false;
	}
}
