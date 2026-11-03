// What the unit tests see as `obsidian` (vitest.config.mts). The UI actions
// they test import a few helpers from it at module load, but only call them
// on a live pointer or menu, which the tests never make, so no-ops will do.

export function setIcon(): void {}
export function setTooltip(): void {}
