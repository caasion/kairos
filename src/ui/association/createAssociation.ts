// Creating a project or domain from the association picker.
//
// Typing a name that doesn't exist yet offers "Create project" and "Create
// domain" rows, so structure can grow out of tasks you already have instead of
// being set up first. This makes the file (a domain-less project, or a domain)
// through the index, then hands back the association the picker applies.

import { Notice } from "obsidian";
import type { KairosIndex } from "../../index";
import type { Association } from "../../types";
import { newNameProblem } from "../../associationOptions";

export async function createAssociation(
	index: KairosIndex,
	kind: Association["kind"],
	name: string,
): Promise<Association | null> {
	const trimmed = name.trim();
	const problem = newNameProblem(trimmed);
	if (problem) {
		new Notice(problem);
		return null;
	}
	const clash = index.nameCollision(trimmed);
	if (clash) {
		new Notice(`"${trimmed}" is already taken by "${clash}".`);
		return null;
	}
	try {
		if (kind === "project") await index.createProject(trimmed);
		else await index.createDomain(trimmed);
	} catch {
		new Notice(`Kairos couldn't create the ${kind} "${trimmed}".`);
		return null;
	}
	return { kind, id: trimmed };
}
