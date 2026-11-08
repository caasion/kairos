# Kairos

Kairos is an Obsidian community plugin for planning a day in time blocks. It's written in TypeScript and Svelte 5 and bundled by esbuild into `main.js`. Everything it shows is derived from markdown in the vault: the `## Schedule` section of daily notes, project and domain files, `Backlog.md` and `Routines.md`. The [Reference](docs/reference.md) has the full format.

Human contributors start with [`CONTRIBUTING.md`](CONTRIBUTING.md). This file is the same ground for coding agents, plus the rules the code follows.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Build `main.js` and rebuild on change |
| `npm run demo-vault` | Build a vault in `demo-vault/` dated around today, linked to this build. `-- --reset` rebuilds it |
| `npm run check` | Everything CI runs: build with type checking, ESLint, Stylelint, unit tests, `svelte-check` |
| `npm test` | Unit tests only (Vitest) |
| `npm run build` | Type check and production build |

Run `npm run check` before calling a change done. ESLint warnings don't fail it; don't add new ones.

## Where things are

The engine is plain TypeScript with no Obsidian dependency, so it can be unit tested in Node. The views sit on top of it.

- **Markdown in and out:** `parser.ts` reads a daily note's schedule into blocks and tasks, `serializer.ts` writes them back, and `writer.ts` is the only module that changes daily notes. `section.ts` finds the schedule heading. `backlog.ts`, `projectFile.ts` and `routines/routinesFile.ts` do the same for the other files.
- **The index:** `index.ts` keeps everything parsed in memory and is what every view reads. `indexAdapter.ts` is the only place it touches the real vault. `resolver.ts` works out what a task belongs to (its own association, else its block's).
- **Features:** `backlog*.ts`, `carry.ts` (unfinished tasks offered to the next day), `routines/` (repeating blocks and tasks), `gantt/` (the Timeline view's spans), `onboarding/` (the guided tour), `taskDrop.ts` (where a dragged task lands).
- **Views:** `Kairos*View.ts` are Obsidian `ItemView`s that mount Svelte components from `src/ui/`. The Day view is `KairosView.ts`.
- **UI:** `src/ui/<view>/` holds each view's components, `src/ui/components/` the shared design-system components, and `src/ui/actions/` Svelte actions for pointer, touch and hover handling.
- **Plugin lifecycle:** `main.ts` registers views, commands and settings. Settings are declared once in `settingDefinitions.ts` and rendered by `settings.ts`.
- **Tests:** `*.test.ts` next to the code they test. `src/demoVault.test.ts` reads the demo vault from `scripts/demo-vault.mjs` with the real parsers.

The folder layout is under discussion in [#141](https://github.com/caasion/kairos/pull/141). Until that's settled, put new code beside the code it works with.

Some comments cite a numbered decision ("decision 73") or a spec section. Those are in the maintainer's design notes, which aren't public yet ([#142](https://github.com/caasion/kairos/issues/142)). The comment around the number says what was decided; follow it.

## Rules the code follows

- **Markdown is the source of truth.** Plans, tasks and history live in the vault's notes, never only in plugin data. A write changes the schedule section and leaves the rest of the note (frontmatter, other headings, prose) untouched, and Kairos never rewrites frontmatter it didn't write.
- **Writes go through the write layer.** Change daily notes through `writer.ts`, not by editing file text in a view.
- **Keep the engine free of Obsidian.** Modules that tests import must not import `obsidian`. Pass what they need in. Tests resolve `obsidian` to `src/testing/obsidianStub.ts`, which only covers a few helpers.
- **Test the logic.** A change to parsing, writing, the index or a view model comes with a unit test. If it changes the markdown Kairos writes, update `docs/reference.md` and `scripts/demo-vault.mjs` too.
- **Build UI from the design system.** Read [`DESIGN.md`](DESIGN.md) before adding or changing UI, and use its components (`IconButton`, `AssocGroup`, …) and tokens instead of copying another view's CSS. `src/designSystem.test.ts` fails on new hex colours, pixel font sizes or radii, pasted SVG icons and hand-made frameless buttons.
- **Work on touch.** Kairos runs on phones and tablets (`isDesktopOnly` is false). No Node or Electron APIs in plugin code. Anything done by hover or right-click needs a touch path too; see [Use Kairos on mobile](docs/guide.md#use-kairos-on-mobile).
- **Popout windows.** Use `window.setTimeout`, `window.requestAnimationFrame` and the like, so timers run in the right window.
- **Clean up.** Register DOM events, intervals and workspace events with the plugin's `register*` helpers, so disabling Kairos leaves nothing behind.
- **Stable IDs.** Never rename a command ID, a view type, a setting key or the plugin ID (`kairos`). People's hotkeys and saved data depend on them.
- **Local only.** No network requests, telemetry or remote code. Kairos reads and writes only the files it manages in the vault.

## Writing UI text and docs

- Sentence case for headings, buttons and commands.
- Name UI labels in **bold** and say "select" for clicking or tapping: select **Add all**.
- Navigation uses arrows: **Settings → Community plugins**.
- Write modifier keys as Ctrl/Cmd.
- Keep in-app text short and free of jargon. A user-visible change gets a line in the [Guide](docs/guide.md) or the [Reference](docs/reference.md).

## Pull requests

PRs go against `main`, one change each, and say how the change was tried in Obsidian (see [`CONTRIBUTING.md`](CONTRIBUTING.md#pull-requests)). Name commits by what they do, starting with the area: `Week view: Show where a moved block lands (#71)`. Don't commit `main.js`, `data.json` or `demo-vault/`.

## Releases

The maintainer cuts releases. Each one gets a `release/x.y.z` branch, `npm version x.y.z` bumps `package.json`, `manifest.json` and `versions.json`, and pushing a tag with exactly that version (no leading `v`) makes `.github/workflows/release.yml` build a draft GitHub release with `main.js`, `manifest.json` and `styles.css`. The release branch is then merged into `main`. Keep `minAppVersion` in `manifest.json` accurate when using newer Obsidian APIs.

## References

- Obsidian API docs: https://docs.obsidian.md
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Developer policies: https://docs.obsidian.md/Developer+policies
