import { App, FuzzyMatch, FuzzySuggestModal, TFile } from "obsidian";

export class NoteLinkSuggester extends FuzzySuggestModal<TFile> {
	private onPick: (file: TFile | null) => void;
	private allowClear: boolean;

	constructor(app: App, opts: { allowClear?: boolean; onPick: (file: TFile | null) => void }) {
		super(app);
		this.onPick = opts.onPick;
		this.allowClear = !!opts.allowClear;
		this.setPlaceholder("Search notes…");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onPick(item);
	}

	onClose(): void {
		// Allow clearing by closing without choice if allowed.
		if (this.allowClear && !this.resolvedFile) this.onPick(null);
	}

	private resolvedFile: TFile | null = null;
	selectSuggestion(value: FuzzyMatch<TFile>, evt: MouseEvent | KeyboardEvent): void {
		this.resolvedFile = value.item;
		super.selectSuggestion(value, evt);
	}
}
