# Guide

How to do things in Kairos, grouped by what you're trying to do. If you haven't used Kairos before, start with [Getting started](getting-started.md).

Tasks and blocks keep their actions in their top-right corner. Point at a task or block, and a small colored fold appears in that corner, growing as you get closer. Move to the fold to see the actions. You can also right-click any task or block.

## Plan a day (Day and Week views)

The Day view shows one day and opens in the right sidebar. The Week view shows several days side by side; set how many with the gear in its header (**Days before today**, **Days after today**).

**Blocks**

- **Make a block:** drag down on empty time. It snaps to 5 minutes. A plain click doesn't make one.
- **Rename it:** select its title.
- **Change its time:** select the time and type a range, like `14:00-15:30`. A block can end at `24:00`.
- **Move it:** drag an empty part of the block. In the Week view you can drag it to another day.
- **Resize it:** drag its top or bottom edge.
- **Select several:** Shift+click or Ctrl/Cmd+click them, then drag any one to move them all.
- **Delete it:** point at its top-right corner and select **Delete block**, or select it and press **Delete**. Deleting a block deletes its notes; its tasks move to Unscheduled.
- **Associate it with a project or domain:** point at its top-right corner, or right-click it, and select **Add association**. Type a name that doesn't exist yet to create it: select **Create project** or **Create domain**.

**Tasks**

- **Add a task:** point at the block's top-right corner and select **Add task**, or right-click the block.
- **Rename it:** select its text. **Enter** saves, **Esc** cancels.
- **Check it off:** select its checkbox. Each click moves it along: open → half-done → done → open.
- **Cancel it:** press and hold its checkbox, or right-click and select **Mark cancelled**.
- **Move it:** press and hold its text, then drag it to another block. Drop it on **Unscheduled** to take its time away, or on empty time to make a new 30-minute block around it. Hold **Ctrl/Cmd** to drop a copy instead.
- **Move it to another block without dragging:** point at its top-right corner, or right-click it, and select **Move to another block** (**Nest under block** for an unscheduled task).
- **Give it its own association:** point at its top-right corner and select **Add association**. Without one, a task belongs to its block's project or domain.

**Notes**

A note records what happened in a block, like "Ran late, skipped the review".

- **Add a note:** point at the block's top-right corner and select **Add note**.
- **Edit it:** select it. Clear the text to delete it.

**When a block is too small for its tasks**, its last row says "N more". Point at it or tap it, and the block grows to show everything.

Above the timeline, a row of pills holds what isn't on it yet: **Unscheduled** (tasks without a time), **Left from** (see below), **Resurfacing** and missing routines. Point at a pill to peek at its list. Select it to open the list above the timeline, and select it again to close it. To schedule a task, drag it from the list onto the timeline. The **Unscheduled** pill also shows whenever you're dragging a task; drop on it to take a task out of its block. In the Week view, point at a day's part of the **Unscheduled** line and select **+** to add a task there.

## Triage in the Grid

The Grid has one row per project and domain, and one column per day. Use it to see what you're working on and when, and to move things around.

- **Rows:** projects without a domain come first, then each domain followed by its projects. **Unassociated** at the bottom holds tasks with no project or domain.
- **Cells:** tasks are grouped under their block's time and title. Tasks with no time are under **Unscheduled**, last.
- **Dimmed cells** are days when that project or domain wasn't active. You can't add to them.

**Adding and moving**

- **Add a task to a block:** point at the top-right corner of the block's header and select **Add task**. A block header has the same corner actions as a block in the Day view.
- **Add a task without a time:** select the **+** in the cell's corner, or the **+** on its Unscheduled header.
- **Move a task:** press and hold its text, then drag.
  - Onto a block in the same cell: it moves into that block.
  - Onto another row: it changes project or domain.
  - Onto another day: it moves to that day.
  - Onto the Day or Week view: it's scheduled there, the same as a drag inside the timeline.
  - Hold **Ctrl/Cmd** to drop a copy.
- **Move a whole block:** press and hold its header, then drag it to another day or row.
- **Switch the Day view to another day mid-drag:** hold the dragged task over that day's column header for a moment.

**Linking to the timelines**

- **Select a column header** to show that day in the Day view. Ctrl/Cmd+click it to open the day's note.
- **Ctrl/Cmd+click a block's header** to see it in the Day view.
- **Follow the grid** (on by default): when you work on a day in the Grid, the Day view shows that day. Toggle it with the button in the Day view's header.
- **Highlight across views** (on by default): pointing at a block or task lights it up in every open view.

**Rolling a project into its domain**

Some projects are worth naming but not worth a row of their own, like "Groceries" under "Life". Right-click the project's row label and select **Show on domain's row**. Its tasks then show on the domain's row. To undo, right-click the domain's row label, pick the project, and select **Give its own row**.

Right-click a project's row label and select **Change domain** to move it to another domain.

## Keep a backlog

The backlog holds things you mean to do but haven't given a day. It lives in one file, `Backlog.md`. The Backlog view opens in the right sidebar.

- **Add an item:** select the **+** on a group. Items are grouped by project or domain; **Unassociated** holds the rest.
- **Edit an item:** select its text. Clear the text to delete it.
- **Bring it back on a date:** point at the item's right edge and select **Set a resurface date**.

On that date the item appears in your day: in the Day view under the **Resurfacing** pill, and in the Grid on its row. Select its **arrow** to schedule it into that day as a task. Point at its corner and select **Resurface later** to push it back.

To send a task back to the backlog, right-click it and select **Move to backlog**.

## Set up routines

Routines are blocks and tasks that repeat, like a morning routine on weekdays or the gym on Tuesdays and Thursdays. They live in one file, `Routines.md`.

**Make a routine**

- Right-click a task or a block in any view and select **Repeat…**. Choose when it repeats. The one you right-clicked stays where it is as the first occurrence.
- Or open the **Routines** view from the hourglass menu and select **New routine**.

**Add routines to a day**

Kairos doesn't fill your days by itself. When a day is missing routines, it tells you:

- In the Day view, a pill above the timeline shows the count.
- In the Week and Grid views, a small pill on the day's header shows the count.

Point at the pill to see the list. Select a routine's arrow to add it, or **Add all**. If you delete a routine from a day after that, Kairos won't offer it again for that day.

You can also run **Apply routines to this day** from the command palette. To add routines automatically whenever a daily note is created, turn on **Settings → Kairos → Add routines to new daily notes**.

**Edit routines**

The Routines view groups routines by when they repeat. Select a time or title to edit it, or point at a block's top-right corner to add a task, change its association or when it repeats, or delete it. Unscheduled has only a **+**, to add a task. Select **Open file** to edit `Routines.md` by hand.

A routine that belongs to an inactive project or domain is paused, and shows as **Paused**. It comes back when the project is active again.

## Carry unfinished tasks forward

Open and half-done tasks from your most recent earlier note show in today's Day view under the **Left from** pill for that day. Nothing moves until you choose:

- **Mark it done:** select the checkbox. The task is ticked on the day you left it, for something you did but forgot to tick. Long-press to cancel it instead.
- **Bring it to today:** select the arrow. The task moves into today's **Unscheduled**.
- **Bring all** moves every task in the list.
- **Leave the rest** keeps the remaining tasks open where they are and hides the list for today.

Done and cancelled tasks are never listed. A task that today already has, such as a routine task, isn't listed either.

## Manage projects and domains

Open **Projects & domains** from the hourglass menu.

- **New project or domain:** select **New project** or **New domain** in the header. To make a project inside a domain, right-click the domain and select **Add project**.
- **Or create one as you go:** in any association picker, type a new name and select **Create project** or **Create domain**.
- **Rename:** select the name. Kairos keeps the old name as an alias, so old notes still point to it.
- **Open the note:** Ctrl/Cmd+click the name. Add whatever you like below the frontmatter.
- **Domain color:** select the color swatch.
- **Domain order:** select **Reorder domains**.
- **More:** right-click, or select **⋯**, for **Change domain**, **Set inactive**, **Archive**, **Status history…**, and **Delete**.
- **Filter:** the **Active**, **Inactive** and **Archived** buttons in the header.

**Focus over time**

A project is never done. Instead it's active, inactive or archived, and Kairos keeps a dated history of each change. When you set something inactive or archived, Kairos asks why; you can skip it.

Each active stretch can carry:

- an **intention**: what you mean to do with the project for now, like "sprint prep for the hackathon".
- an **intensity** from 0 to 5: how hard you're pushing it. 0 means active but no time going in; 5 means all in.

Edit these in **Status history…**, or in the Timeline view.

## See your focus over time (Timeline view)

The Timeline view draws each project's active stretches as bars. Switch between **Week**, **Month**, **Quarter** and **Year** in the header.

- **Add an active stretch:** drag across an empty part of a row. It covers every day you drag over, including the one you let go on. A single click starts an open-ended one.
- **Move its start or end:** drag the bar's left or right edge.
- **Set its intensity:** three small lines on the bar show the level, lighting from the bottom: 1 lights the bottom line, 2 adds a dim one above it, and 5 lights all three. Select a line to light up to it (select the top lit line again to dim it), select the bar and press **0** to **5**, or right-click it and choose **Intensity**.
- **Edit its intention:** double-click the bar.
- **More:** right-click the bar for exact dates and **Delete**.

In the Grid, each row's label shows its current intensity, and a small marker shows on days where it changes.

## Use Kairos on mobile

Kairos is desktop-first. On a phone or tablet:

- Tap a checkbox to change it; press and hold it to cancel the task.
- Tap text to edit it; press and hold, then move, to drag a task.
- Tap "N more" to grow a block, and tap a routines pill to open it.
- Some actions are only in right-click menus, so they aren't available on touch yet: **Move to backlog** and the Grid's row menus.
