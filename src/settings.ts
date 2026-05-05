import { App, PluginSettingTab, Setting } from "obsidian";
import type MapMarkPlugin from "./main";
import { BUILTIN_PROVIDERS, makeCustomProvider } from "./tileProviders";
import type { CustomProvider, MapMarkSettings } from "./types";

export class MapMarkSettingTab extends PluginSettingTab {
	plugin: MapMarkPlugin;

	constructor(app: App, plugin: MapMarkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default tile provider")
			.setDesc("Used when a code block does not specify a provider and the sidecar has no saved view.")
			.addDropdown((dd) => {
				for (const p of BUILTIN_PROVIDERS) dd.addOption(p.id, p.name);
				for (const c of this.plugin.settings.customProviders) dd.addOption(c.id, c.name);
				dd.setValue(this.plugin.settings.defaultProvider);
				dd.onChange(async (v) => {
					this.plugin.settings.defaultProvider = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Default zoom")
			.setDesc("Initial zoom level when no view is saved.")
			.addText((t) => {
				t.setValue(String(this.plugin.settings.defaultZoom));
				t.onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n)) {
						this.plugin.settings.defaultZoom = n;
						await this.plugin.saveSettings();
					}
				});
			});

		new Setting(containerEl)
			.setName("Default map height (px)")
			.addText((t) => {
				t.setValue(String(this.plugin.settings.defaultHeight));
				t.onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n > 0) {
						this.plugin.settings.defaultHeight = n;
						await this.plugin.saveSettings();
					}
				});
			});

		new Setting(containerEl)
			.setName("Snapshot location")
			.setDesc("Where snapshot PNGs are saved when you capture one.")
			.addDropdown((dd) => {
				dd.addOption("next-to-map", "Beside the map source file");
				dd.addOption("custom", "Custom folder");
				dd.addOption("attachment", "Use Obsidian attachment folder");
				dd.setValue(this.plugin.settings.snapshotLocation);
				dd.onChange(async (v) => {
					this.plugin.settings.snapshotLocation = v as MapMarkSettings["snapshotLocation"];
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.snapshotLocation === "custom") {
			new Setting(containerEl)
				.setName("Snapshot folder")
				.setDesc("Vault-relative folder for snapshot PNGs (e.g. \"maps/snapshots\"). Created on first capture.")
				.addText((t) => {
					t.setValue(this.plugin.settings.snapshotFolder);
					t.setPlaceholder("maps/snapshots");
					t.onChange(async (v) => {
						this.plugin.settings.snapshotFolder = v.trim();
						await this.plugin.saveSettings();
					});
				});
		}

		const linzSetting = new Setting(containerEl)
			.setName("LINZ API key")
			.setDesc("Required for the LINZ Aerial provider.")
			.addText((t) => {
				t.setValue(this.plugin.settings.linzApiKey);
				t.setPlaceholder("c01...");
				t.onChange(async (v) => {
					this.plugin.settings.linzApiKey = v.trim();
					await this.plugin.saveSettings();
				});
			});
		const linkEl = linzSetting.descEl.createEl("a", {
			text: " Get a free key from basemaps.linz.govt.nz",
			href: "https://basemaps.linz.govt.nz",
		});
		linkEl.setAttr("target", "_blank");

		new Setting(containerEl).setName("Custom providers").setHeading();
		const list = containerEl.createDiv({ cls: "mapmark-custom-providers" });
		for (const provider of this.plugin.settings.customProviders) {
			this.renderCustomProvider(list, provider);
		}
		new Setting(containerEl).addButton((b) => {
			b.setButtonText("Add custom provider");
			b.onClick(async () => {
				this.plugin.settings.customProviders.push(makeCustomProvider());
				await this.plugin.saveSettings();
				this.display();
			});
		});
	}

	private renderCustomProvider(parent: HTMLElement, provider: CustomProvider) {
		const wrap = parent.createDiv({ cls: "mapmark-custom-provider" });
		new Setting(wrap)
			.setName("ID")
			.addText((t) => {
				t.setValue(provider.id);
				t.onChange(async (v) => {
					provider.id = v.trim();
					await this.plugin.saveSettings();
				});
			});
		new Setting(wrap)
			.setName("Name")
			.addText((t) => {
				t.setValue(provider.name);
				t.onChange(async (v) => {
					provider.name = v;
					await this.plugin.saveSettings();
				});
			});
		new Setting(wrap)
			.setName("Type")
			.setDesc("XYZ for tile templates, WMS for OGC WMS endpoints.")
			.addDropdown((dd) => {
				dd.addOption("xyz", "XYZ tiles");
				dd.addOption("wms", "WMS");
				dd.setValue(provider.type ?? "xyz");
				dd.onChange(async (v) => {
					provider.type = v === "wms" ? "wms" : "xyz";
					await this.plugin.saveSettings();
				});
			});
		new Setting(wrap)
			.setName("URL template")
			.setDesc("XYZ: use {z}/{x}/{y}. WMS: bare GetMap endpoint, no query string. {api_key} is substituted if needed.")
			.addText((t) => {
				t.setValue(provider.url);
				t.onChange(async (v) => {
					provider.url = v.trim();
					await this.plugin.saveSettings();
				});
			});
		new Setting(wrap)
			.setName("WMS layers")
			.setDesc("WMS only: comma-separated layer names (e.g. \"0\" or \"image,boundary\").")
			.addText((t) => {
				t.setValue(provider.layers ?? "");
				t.onChange(async (v) => {
					provider.layers = v.trim() || undefined;
					await this.plugin.saveSettings();
				});
			});
		new Setting(wrap)
			.setName("WMS format")
			.setDesc("WMS only: image MIME (default image/png).")
			.addText((t) => {
				t.setValue(provider.format ?? "");
				t.setPlaceholder("image/png");
				t.onChange(async (v) => {
					provider.format = v.trim() || undefined;
					await this.plugin.saveSettings();
				});
			});
		new Setting(wrap)
			.setName("Attribution")
			.addText((t) => {
				t.setValue(provider.attribution ?? "");
				t.onChange(async (v) => {
					provider.attribution = v;
					await this.plugin.saveSettings();
				});
			});
		new Setting(wrap)
			.setName("Max zoom")
			.addText((t) => {
				t.setValue(String(provider.maxZoom ?? 19));
				t.onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n)) {
						provider.maxZoom = n;
						await this.plugin.saveSettings();
					}
				});
			});
		new Setting(wrap)
			.setName("API key")
			.addText((t) => {
				t.setValue(provider.apiKey ?? "");
				t.onChange(async (v) => {
					provider.apiKey = v;
					await this.plugin.saveSettings();
				});
			});
		new Setting(wrap).addButton((b) => {
			b.setButtonText("Remove").setWarning();
			b.onClick(async () => {
				this.plugin.settings.customProviders = this.plugin.settings.customProviders.filter((p) => p !== provider);
				await this.plugin.saveSettings();
				this.display();
			});
		});
	}
}
