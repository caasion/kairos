# Reference

The markdown Kairos reads and writes, every mouse and keyboard shortcut, and all settings. For how-tos, see the [Guide](guide.md).

## The markdown format

### A day

Kairos reads the section of your daily note under `## Schedule` (you can change the heading in settings). If the heading is missing, Kairos adds it at the end of the note.

```markdown
## Schedule
- 09:30 - 11:00 Deep Work [Thesis]
	- [ ] Rework chapter 2
	- [/] Fix the figures (p1)
	- Got through half of it
- 13:00 - 14:00 Gym [D:Health]
	- [x] Gym
- Unscheduled
	- [ ] Call mom [D:Home]
```

| Line | What it is |
|---|---|
| `- 09:30 - 11:00 Title` | A **block**. Midnight is written `24:00`. |
| `- Unscheduled` | The day's block for tasks with no time. |
| `	- [ ] Text` (indented) | A **task** in the block above it. |
| `	- Text` (indented, no checkbox) | A **note**: a record of what happened. |

**Task statuses:** `[ ]` open, `[/]` half-done, `[x]` done, `[-]` cancelled.

**At the end of a line, in this order:**

- `[Project name]` associates the block or task with a project.
- `[D:Domain name]` associates it with a domain.
- `(text)` is a free tag of your own, like `(p1)` or `(assignment 5)`.

A task without an association belongs to its block's project or domain. When Kairos moves it out of that block, it writes the association onto the task so the line stays true.

**Older lines.** A timed line with a checkbox (`- [x] 13:00 - 14:00 Gym`) reads as a block holding a task of the same name, and is rewritten in the two-line form above. An untimed line with a checkbox at the top level (`- [ ] Call mom`) reads as a task in Unscheduled.

> [!warning]
> Kairos rewrites the whole Schedule section when it saves a change. Text in it that isn't a list item, like a paragraph or a blank line, is removed, and bullets nested more than one level deep are flattened. Keep prose outside the section. Everything else in the note is left alone.

### Backlog.md

```markdown
- Read Atomic Habits [D:Learning] 📅 2026-11-01
- Fix bike
- Draft outline [Novel] 📅 2026-10-25
```

Each line is an item, with an optional association and an optional resurface date after 📅.

> [!warning]
> Kairos rewrites the whole backlog file when you change an item. Headings and other text in it are removed.

### Routines.md

```markdown
## Weekdays
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
- 18:00 - 19:00 Gym [D:Health] 🔁 Tue, Thu

## Daily
- Unscheduled
	- [ ] Water the plants [D:Home]
- Night Routine
	- [ ] Journal

## Monthly on 15
- Unscheduled
	- [ ] Pay rent
```

- A heading says when the routines under it repeat. `🔁 rule` at the end of a line overrides it for that line.
- A timed line is a block routine; tasks under it come with it.
- An untimed line without a checkbox, like `- Night Routine`, only names a block for the tasks under it. It isn't a routine itself.
- Tasks under `- Unscheduled` repeat without a time.

**Rules** (any case; "every" in front is optional):

| Rule | Examples |
|---|---|
| Every day | `Daily`, `Every day` |
| Monday to Friday | `Weekdays` |
| Saturday and Sunday | `Weekends` |
| Certain days | `Mon, Wed, Fri`, `Tue/Thu`, `Tuesday and Thursday`, `Every Sunday` |
| A day of the month | `Monthly on 15`, `Every month on the 1st`. A month without that day skips it. |

Lines Kairos can't read are listed at the top of the Routines view.

### Project and domain files

Kairos finds projects in the `Projects` folder and domains in the `Domains` folder (both can be changed in settings). A file counts only if its frontmatter has the tag `kairos/project` or `kairos/domain`, which Kairos adds when you create one from the Projects & domains view. The file name is the project's name.

```yaml
---
tags:
  - kairos/project
id: q8w7e6r5
aliases: []
description: ""
domain_id: k3j9x2ab
status:
  2026-10-01:
    status: active
    intensity: 4
    note: Prep for the trip
  2026-10-27:
    status: inactive
    why: Exam done
---
```

- `domain_id` is the `id` of the project's domain.
- `status` holds dated records. `status` is `active`, `inactive` or `archived`; `intensity` (0–5), `note` (the intention) and `why` are optional. With no records, a project counts as active.
- `rollup: true` shows the project's tasks on its domain's row in the Grid.

### Frontmatter Kairos adds to daily notes

- `kairos-carried`: the earlier day whose unfinished tasks were dealt with, written when you select **Leave the rest**. Notes from earlier versions have it from when tasks moved automatically. Safe to delete: today is then offered that day's open tasks again.
- `kairos-routines`: a fingerprint of the routines the day was set up with. Safe to delete: the day is then offered its routines again.

## Mouse and keyboard

### Everywhere

| Do this | To |
|---|---|
| Point at a row's top-right corner | Show its actions (tasks, blocks, Grid block headers) |
| Point at a backlog item's right edge | Show its actions |
| Right-click | Open the full menu for a task, block, note, Grid row label, project, domain or Timeline bar |
| Select text | Edit it. **Enter** saves, **Esc** cancels |
| Point at cut-off text, or press and hold it on touch | Read all of it |
| Select a checkbox | Open → half-done → done → open |
| Press and hold a checkbox | Mark the task cancelled |
| Press and hold a task's text, then move | Drag the task |
| Hold **Ctrl/Cmd** while dropping | Drop a copy |
| **Esc** during a drag | Cancel it |
| Ctrl/Cmd+click a date | Open (or create) that day's note |
| Ctrl/Cmd+click a task's or block's project | Open the project's note |

### Day and Week views

| Do this | To |
|---|---|
| Drag on empty time | Make a block |
| Drag an empty part of a block | Move it (in Week, also to another day) |
| Drag a block's top or bottom edge | Resize it |
| Select a block's time | Type a new time range |
| Shift+click or Ctrl/Cmd+click blocks | Select several |
| **Delete**, **Backspace** or **X** | Delete the selected blocks (their tasks move to Unscheduled) |
| Point at or select "N more" | Grow the block to show all its tasks |
| Drop a task on empty time | Make a 30-minute block around it |
| Drop a task on Unscheduled | Take its time away |

### Grid

| Do this | To |
|---|---|
| Select a column header | Show that day in the Day view |
| Hold a dragged task over a column header | Switch the Day view to that day |
| Ctrl/Cmd+click a block's header | Show the block in the Day view |
| Press and hold a block's header, then move | Drag the whole block to another day or row |
| Drop a task on another row | Change its project or domain |
| Right-click a row label | **Change domain**, **Show on domain's row** |

### Timeline view

| Do this | To |
|---|---|
| Drag across an empty part of a row | Add an active stretch |
| Click an empty part of a row | Start an open-ended active stretch |
| Drag a bar's left or right edge | Move its start or end |
| Click a bounded bar's right edge without dragging | Remove its end date |
| Select one of a bar's three intensity lines | Light its intensity up to that line (select the top lit line again to dim it) |
| Select a bar, then press **0**–**5** | Set its intensity |
| Right-click a bar, then **Intensity** | Set or clear its intensity |
| Select a bar, then press **Delete** | Delete the stretch |
| Double-click a bar | Edit its intention |

## Commands

- Open day view
- Open week view
- Open grid view
- Open backlog view
- Open projects & domains view
- Open timeline view
- Open routines view
- Apply routines to this day

## Settings

Find these in **Settings → Kairos**. Some are also in a view's gear menu.

| Setting | Default | What it does |
|---|---|---|
| Timeline start hour | 6 | The first hour shown in the Day and Week views. |
| Timeline end hour | 24 | The last hour shown. |
| Timeline hour height | 60 | Pixels per hour. |
| Days before today | 1 | How many past days the Week view and Grid show. |
| Days after today | 5 | How many future days the Week view and Grid show. |
| Show unscheduled tasks in the grid | On | Show each day's tasks without a time in the Grid's cells. Off, they're listed behind the Unscheduled badge on the day's header. |
| Show projects on rolled-up tasks | Off | On a domain row with rolled-up projects, show each task's project at the end of its line. |
| Highlight across views | On | Pointing at a block or task lights it up in every view. |
| Follow the grid | On | Working on a day in the Grid shows it in the Day view, and in the Week view when it's out of sight. |
| Name for blocks made by a drop | (empty) | The title of a block made by dropping a task on empty time. Empty uses the task's project or domain. |
| Schedule section heading | `## Schedule` | The heading Kairos reads and writes in each daily note. |
| Ask when creating a block | Off | Open the association picker when you make a block. |
| Ask when creating a backlog item | Off | Open the association picker when you add an unassociated backlog item. |
| Add routines to new daily notes | Off | Add a day's routines as soon as its note is created. |
| Projects folder | `Projects` | Where project files live. |
| Domains folder | `Domains` | Where domain files live. |
| Backlog file | `Backlog.md` | The backlog file. |
| Routines file | `Routines.md` | The routines file. |
