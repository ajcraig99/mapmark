# MapDraw

Embed annotated, drawable [Leaflet](https://leafletjs.com/) maps inside Obsidian notes via fenced code blocks. Annotations live in sidecar JSON files alongside your notes, so they sync, version, and back up exactly like the rest of your vault.

> **Status:** desktop only. `isDesktopOnly: true` in the manifest. All file I/O still goes through the vault adapter so a mobile flip is a future config change once it has been tested.

---

## Features

- **Drawable maps in any note.** A `mapdraw` fenced code block renders a fully interactive Leaflet map with a drawing toolbar.
- **Sidecar JSON storage.** Shapes, view, provider, and overlay live in a plain JSON file at the path you pick, so they sync, diff, and back up like any other note.
- **Multiple tile providers built in,** including OpenStreetMap-style (CartoDB), Esri World Imagery, OpenTopoMap, LINZ Aerial / Topographic (NZ), and Landgate WA Aerial.
- **Custom providers.** Add your own XYZ or WMS endpoints in settings, with optional API keys.
- **Two-layer rendering.** Stack a translucent overlay (e.g. topo lines on aerial imagery).
- **Snapshot mode.** Capture a PNG of the current map view; the live map collapses to that image until you choose to edit again. Snapshot files can live next to the source, in a custom folder, or in your Obsidian attachment folder.
- **Note links on markers.** Attach a vault note to any marker; clicking it in reading mode opens the linked note.
- **Reading mode aware.** The toolbar and chrome disappear in reading mode; markers still respond to hover and click.
- **External-edit safe.** Editing the sidecar JSON in another pane re-renders any open map of that file live.

## Drawing toolkit

A floating toolbar lives in the top-left of every map (edit mode only):

| Tool        | Gesture                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| Select / pan | Default. Click a shape to select; drag handles to edit; **Delete** removes; **Esc** clears selection |
| Marker      | Click to place. A note picker opens for an optional vault link                                |
| Line        | Click points; **double-click** or **Enter** to finish; **Esc** to cancel                       |
| Polygon     | Same as line but closes                                                                        |
| Rectangle   | Click + drag                                                                                   |
| Circle      | Click centre, drag to set radius                                                               |
| Freehand    | Mouse down + drag + release. Path is simplified with Douglas-Peucker (~3 px screen tolerance) |
| Text        | Click to place, then enter the label text                                                      |

A style panel for the selected shape lets you tweak stroke colour / weight / opacity, fill colour / opacity, marker icon (Lucide name), text font size, label, and the marker's note link.

## Install (manual, before community-plugin acceptance)

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. Copy them into a folder named `mapdraw` inside `<your-vault>/.obsidian/plugins/`.

   ```
   <vault>/.obsidian/plugins/mapdraw/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

3. Reload Obsidian and enable **MapDraw** under **Settings → Community plugins**.

## Usage

Drop a fenced code block in any note:

~~~markdown
```mapdraw
source: maps/auckland-walks.map.json
provider: linz-aerial      # optional, overrides default & saved view
overlay: linz-topo         # optional second translucent layer
height: 500                # optional, px
defaultZoom: 14            # optional, overrides the saved view
```
~~~

`source` is a vault-relative path to a sidecar JSON file. If the file does not exist on first preview, MapDraw shows a **Create map at this path** button that writes a stub.

### What gets persisted

- **Shapes** save automatically on edit (debounced 500 ms) to the sidecar JSON.
- **View** (centre / zoom / provider / overlay) only saves when you press **Save view** in the bottom-right. This is intentional — incidental panning shouldn't dirty the file.
- The vault `modify` event triggers a re-render, so external edits to the sidecar JSON show up live.

### Snapshots

Press the camera icon to capture a PNG of the current map. The live map collapses to the snapshot until you press the edit (pencil) button to go back. The trash button removes the snapshot file as well.

Snapshot location is configurable under **Settings → Snapshot location**:

- **Beside the map source file** — same folder as the sidecar JSON. Default.
- **Custom folder** — vault-relative folder of your choosing. Created on first capture.
- **Use Obsidian attachment folder** — uses whatever you've configured under **Settings → Files and links → Default location for new attachments**.

## Built-in tile providers

| ID                | Name                                | Needs API key                                |
| ----------------- | ----------------------------------- | -------------------------------------------- |
| `carto-voyager`   | CartoDB Voyager (OSM-style)         | —                                            |
| `carto-positron`  | CartoDB Positron (OSM-style, light) | —                                            |
| `esri-imagery`    | Esri World Imagery                  | —                                            |
| `opentopomap`     | OpenTopoMap                         | —                                            |
| `linz-aerial`     | LINZ Aerial (NZ)                    | yes — settings → "LINZ API key"              |
| `linz-topo`       | LINZ Topographic (NZ)               | shares LINZ key                              |
| `landgate-wa`     | Landgate WA Aerial                  | —                                            |

If a provider needs an API key you have not set, an in-map banner with a link to settings appears.

> CartoDB Voyager is OpenStreetMap data rendered & hosted by CARTO. We use it instead of `tile.openstreetmap.org` because OSM's tile usage policy blocks Electron User-Agents (it returns a 200 OK with a 403 image), which silently breaks every map and every snapshot.

### Custom providers

Add your own under **Settings → Custom providers**. Each provider needs:

- **ID** — unique key used by the `provider:` code-block field.
- **Name** — shown in the provider picker.
- **Type** — `XYZ` for tile templates, `WMS` for OGC WMS endpoints.
- **URL template** — XYZ: `{z}/{x}/{y}` placeholders. WMS: bare GetMap endpoint, no query string. `{api_key}` is substituted if needed.
- **WMS layers / format** — WMS only.
- **Attribution / Max zoom / API key** — as required.

## Sidecar JSON schema

```ts
interface MapData {
  schemaVersion: 1;
  view?: {
    center?: [number, number];
    zoom?: number;
    provider?: string;
    overlay?: string;
  };
  locked?: boolean;
  snapshotPath?: string;
  shapes: Shape[];
}
```

Each `Shape` has a `type` discriminator (`marker | line | polygon | rectangle | circle | freehand | text`), plus geometry fields (`position`, `points`, `bounds`, `center`/`radius`), an optional `style`, optional `label`, optional `notePath`, and an optional `groupId` (reserved for future layer/group support).

## Reading vs source mode

- **Reading mode:** the map renders, markers can be hovered (Page Preview tooltip) and clicked (open the linked note), but the toolbar and shape editing are disabled.
- **Live Preview / source mode:** full editing.

## Development

```sh
npm install
npm run dev    # esbuild watch — produces main.js with inline sourcemaps
npm run build  # production build (minified)
npx tsc --noEmit  # typecheck only
```

Symlink or copy the build output into a test vault:

```
<test-vault>/.obsidian/plugins/mapdraw/
├── main.js          (from repo root)
├── manifest.json
└── styles.css
```

Then reload Obsidian (Ctrl/Cmd+R inside the developer console, or toggle the plugin off/on).

## Roadmap

- Layers / groups (data model already has `groupId`)
- Distance & area readouts (already calculated internally; just not displayed)
- Mobile touch (flip `isDesktopOnly: false` once tested)
- Per-map bookmarks

## Licence

[MIT](LICENSE)
