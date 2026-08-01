// Association navigation — the "not-a-router".
//
// Ctrl-clicking an association tag opens its project/domain. Right now that
// means opening the raw markdown file in a new tab. When a rich Project page
// ItemView exists, this ONE function changes to open that view instead, and
// every call site (block tags, task tags, grid cells) upgrades for free. There
// is no custom router: Obsidian's workspace is the router.

import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { ResolvedAssociation } from "./association";

/**
 * Open the project/domain behind a resolved association in a new tab. A no-op
 * when the association didn't resolve to a real file (dangling/unassociated).
 */
export function navigateToAssociation(
	app: App,
	resolved: ResolvedAssociation,
): void {
	if (!resolved.target) return;
	const file = app.vault.getAbstractFileByPath(resolved.target);
	if (!(file instanceof TFile)) return;
	// 'tab' matches Obsidian's ctrl-click convention (open in a new tab).
	void app.workspace.getLeaf("tab").openFile(file);
}
