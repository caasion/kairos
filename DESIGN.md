# Kairos design system

Read this before adding or changing UI.

Kairos should look like part of Obsidian, and the same thing should look the same in every view. It drifted because each view copied another view's CSS and then changed its copy. A frameless icon button, a group heading and a count each existed in several slightly different versions. Shared tokens alone didn't fix that, because every copy still chose its own layout. So the system is built from **components**: one component per repeated piece, used everywhere that piece appears.

It has three parts:

- **Components** in `src/ui/components/` (and the shared pieces still in `src/ui/timeline/`), listed below.
- **Tokens** on `body` in `styles.css`, for the sizes components and views still set themselves.
- **`src/designSystem.test.ts`**, which counts the patterns that caused the drift and fails if any count goes up. Moving a view onto a component lowers a count; lower its baseline in the test to match.

## Rules

1. **Use the component.** If a component exists for what you're making, use it. Don't write a local copy, even a small one. If it doesn't quite fit, add a prop to it.
2. **Obsidian first.** Before styling something, check whether Obsidian already has it: `clickable-icon` for icon buttons, `setIcon` for icons, its colour variables, `--icon-s`/`--icon-m`, `--size-*` spacing, `--font-ui-*` sizes. Kairos's own look (serif names, domain colour bars, date cards) is for what Obsidian doesn't have.
3. **No new drift.** No hex colours, pixel font sizes or pixel radii in a component: use an Obsidian variable or a token. No pasted SVG icons: use an Obsidian icon by name. No hand-made frameless buttons: use `IconButton`.
4. **Global CSS lives in `styles.css`.** That covers anything portaled to `<body>`, created from TypeScript, or shared between components. Every global class starts with `kairos-`.
5. **Beat Obsidian's button and input styles with `body`.** Obsidian styles `button:not(.clickable-icon)` and `input[type='text']` at specificity (0,1,1), which beats a lone class. A global rule for a `<button>` or `<input>` is written `body .kairos-x`. A component's scoped rule (0,2,0) already wins.
6. **Truncated text must be readable.** Anything that ellipsizes or clamps carries `use:peek` (`src/ui/actions/peek.ts`), so pointing at it (or pressing and holding on touch) shows the whole text.
7. **Mind `aria-label`.** Obsidian shows any `aria-label` as a tooltip. On an element that also opens a popover, name it with `aria-labelledby` instead, or the tooltip covers the popover.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--kairos-font-serif` | Georgia | Entity names (row labels, group headings, hover cards), date-card numbers |
| `--kairos-text-display` | 24px | A date card's day number |
| `--kairos-text-domain` | 15px | A domain's name in a row label or group heading |
| `--kairos-text-name` | 13px | A project's name, picker rows, empty states |
| `--kairos-text-body` | 12px | Item text, block titles, controls |
| `--kairos-text-label` | 11px | Buttons, headings, day of week, counts |
| `--kairos-text-meta` | 10px | Metadata lines, hour labels, tags |
| `--kairos-radius-s` | 4px | Small marks: tags, tiny swatches |
| `--kairos-radius-m` | 6px | Buttons, pills, rows |
| `--kairos-radius-l` | 8px | Popovers, cards, date cards |
| `--kairos-accent-width` | 3px | The domain-colour bar down a group or row |

For colour, always use Obsidian's variables: `--text-normal`, `--text-muted`, `--text-faint`, `--interactive-accent`, `--background-modifier-hover`, `--background-modifier-border`, and `--color-red`, `--color-orange`, `--color-green` for status. A domain's own colour reaches a component as a custom property set from data, like `--ag-color`.

## Components

| Component | What it is | Used for |
|---|---|---|
| `IconButton` | Obsidian's frameless icon button (`clickable-icon`), with `label` as its tooltip. `icon` takes an Obsidian icon name; `children` takes an icon Obsidian doesn't have. `primary` puts it in the accent colour, `pressed` shows a toggle that's on, `size="m"` is for headers. | Every icon-only button |
| `icon` action | Draws an Obsidian icon into an element: `<span use:icon={"plus"}>`. Sized by `--icon-size`. | Icons that aren't buttons |
| `ItemRow` | One item in a list: `lead` (an 18px leading control), the text, then `trailing` (a muted label that gives way first), `tag` (where it came from) and `trail` (buttons); `meta` for the line beneath; `actions` for the corner bar, woken by `zone`. `size="m"` for sidebar lists, `square` inside blocks, `lit`/`tinted` for tints in `color`. No state or effects, so it costs nothing per row beyond its elements. | Tasks, leftovers, backlog nudges, backlog entries, the typing row |
| `ItemText` | An item's text: one line or `lines` lines with an ellipsis, peek when truncated, edit in place with `onCommit` (Enter or leaving commits, Escape cancels; `editing` can be bound), hold to drag with `onGrab`. | The text in every `ItemRow` |
| `InlineText` | One line of item text with its links, tags and formatting drawn as Obsidian draws them (`src/inline.ts` parses, cached by text). No box of its own: put it in an element with `kairos-inline`. Links open, preview and resolve through `ui/inline/links.ts`; `renderInline` draws the same from TypeScript. | `ItemText`, block titles and notes, the peek card, drag ghosts |
| `AssocMeta` | An item's project or domain on its meta line, Ctrl/Cmd-click to open. | `ItemRow`'s `meta` |
| `AssocGroup` | A group heading for one project or domain: its icon, the name in serif, a count, an optional "+", and a bar in the domain colour down the whole group. | Unscheduled, the Inbox, the Backlog |
| `RowLabel` | A project's or domain's name, note and intensity in the Grid and Timeline row-label column, with its hover card. | Grid and Timeline rows |
| `IntensityBars` | A project's intensity as three stacked bars. | Grid labels, Timeline bars |
| `Datepicker` | The date navigator and its calendar. | View headers |
| `Portal` | Renders its children at `<body>`, for popovers that mustn't be clipped. | Popovers, pickers |

## Next

These still exist as several copies and are the next components to make, in this order:

1. **Popover**: the panel behind header badges, pickers and hover cards (border, shadow, radius, padding).
2. **Pill and count**: tray pills, header badges, status tags and the counts beside names.
3. **Group heading**: move the Projects view's domain headers and the Routines view's group headers onto `AssocGroup`.
4. **Row buttons**: the corner action bars of tasks, nudges and backlog entries, and the leftover and nudge arrows, onto `IconButton`.
5. **Routine suggestions**: the rows in the Routines alert panel (`RoutinesAlert.svelte`) onto `ItemRow`.
