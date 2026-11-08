# Contributing to Kairos

Thanks for helping. This covers setting up, trying a change in Obsidian, and what a pull request needs. For how Kairos works for its users, read the [Guide](docs/guide.md) and the [Reference](docs/reference.md). The Reference also has the markdown format Kairos reads and writes. For UI work, read [`DESIGN.md`](DESIGN.md) first.

## Set up

You need Node 24 (what CI uses) and Obsidian.

```bash
git clone https://github.com/caasion/kairos.git
cd kairos
npm install
npm run dev
```

`npm run dev` builds `main.js` and rebuilds it whenever a file in `src/` changes. Leave it running.

## Try your change in the demo vault

In a second terminal:

```bash
npm run demo-vault
```

This builds a vault in `demo-vault/` (git ignores it) with two weeks of daily notes around today, projects and domains in each state, routines and a backlog, so every view has something in it. Its plugin folder links to the repo's `main.js`, `manifest.json` and `styles.css`.

1. In Obsidian, open the vault switcher, select **Open folder as vault** and pick `demo-vault`.
2. When Obsidian asks whether you trust the author of the vault, select **Trust author and enable plugins**. Kairos is already on the vault's plugin list.
3. After `npm run dev` rebuilds, run **Reload app without saving** from the command palette to load the new build.

The notes are dated from the day you build them, so rebuild on a new day:

```bash
npm run demo-vault -- --reset
```

`--reset` replaces the notes and Kairos's settings and keeps your Obsidian layout. `--today 2026-11-04` pretends today is another date, and a folder path builds the vault somewhere else (`npm run demo-vault -- ~/Vaults/Kairos`). On Windows, where links need developer mode, the script copies the build instead, and you rebuild the vault with `--reset` after each build.

The demo vault is for trying changes. Don't point a build you're working on at your own vault.

## Before you open a pull request

Run everything CI runs:

```bash
npm run check
```

That's the build (with type checking), ESLint, Stylelint, the unit tests and `svelte-check`. ESLint warnings don't fail it, but don't add new ones.

Then try the change in the demo vault. Unit tests cover the parser, the writer and the view models, not how a view looks or behaves in Obsidian. If you changed how something is dragged, tapped or laid out, check it on touch too: run `app.emulateMobile(true)` in Obsidian's developer console (`app.emulateMobile(false)` to go back), or try it on a phone.

## Pull requests

- Branch from `main` and open the PR against `main`.
- One change per PR. A refactor that touches many files is easier to review on its own, apart from a feature or fix.
- Say what changed and how you tried it in Obsidian. For a UI change, add a screenshot or a short GIF.
- Name commits by what they do, starting with the area: `Week view: Show where a moved block lands (#71)`. Put the issue number in brackets when there is one.
- If you change the markdown Kairos writes, update [`docs/reference.md`](docs/reference.md) and the demo vault (`scripts/demo-vault.mjs`). `src/demoVault.test.ts` checks that Kairos still reads every note the demo vault makes.
- If you change what a user sees or does, update the [Guide](docs/guide.md) or the [Reference](docs/reference.md).

Releases are cut by the maintainer: see [`AGENTS.md`](AGENTS.md#releases).

## Working with coding agents

[`AGENTS.md`](AGENTS.md) is written for coding agents (Claude Code, Codex and others) and is a quick way to learn the code yourself. It has a map of `src/`, the rules the code follows and the commands. Agent-written changes go through the same checks and review as any other.

## Questions

Open an issue, or ask on the pull request. Work on contributor docs and the demo vault is tracked in [#142](https://github.com/caasion/kairos/issues/142).
