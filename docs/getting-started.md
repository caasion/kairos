# Getting started

This guide takes about ten minutes. By the end you'll have planned a day, given your work a project, and seen how the views connect.

On Windows and Linux, read **Cmd** as **Ctrl**.

## Words you'll see

- **Block**: a span of time in your day, like "09:30 - 11:00 Deep Work". Blocks hold tasks. A block is never checked off; it just happens.
- **Task**: something to do, with a checkbox. A task always lives inside a block.
- **Unscheduled**: a block with no time, for tasks you haven't given a time yet. Every day has one.
- **Note**: a bullet under a block without a checkbox. It records what happened, like "Did 40 lengths".
- **Project**: something you're focusing on for a while, like a thesis or a hackathon. A project is never "done"; it's active, inactive or archived.
- **Domain**: a broad area of your life, like School or Health. Projects can sit inside a domain.
- **Association**: the link from a block or task to a project or domain. It's optional.

## 1. Check your daily notes

Kairos keeps your schedule in your daily notes, under a `## Schedule` heading.

1. Open **Settings → Daily notes** and check the **New file location** and **Date format**. Kairos uses the same ones. If you use the Periodic Notes plugin instead, Kairos follows that.
2. You don't need to create a note first. Kairos creates a day's note the first time you add something to that day.

## 2. Open the Day view

1. Select the **hourglass** icon in the left ribbon.
2. Select **Day**. It opens in the right sidebar.

You can also open any view from the command palette: search for "Kairos".

## 3. Make a block

1. In the Day view, press on an empty spot of the timeline and **drag down**. A block appears, called "New block".
2. Select the title to rename it. Type "Deep work" and press **Enter**.
3. Select the time (for example "09:00 - 10:00") to type an exact time, like `9:30-11:00`. Press **Enter**.

To move a block, drag an empty part of it. To make it longer or shorter, drag its top or bottom edge.

## 4. Add tasks

Most actions on a row hide until you point at its **top-right corner**. That's how Kairos keeps the timeline clean.

1. Move the pointer to the top-right corner of your block. A small stack of buttons appears.
2. Select **Add task**. A task called "New task" appears inside the block.
3. Select its text to rename it, then press **Enter**.

You can also right-click a block and select **Add task**.

Now select the task's checkbox. Each click moves it along: open → half-done → done → open. To cancel a task, press and hold its checkbox.

## 5. Look at your note

Cmd+click the date at the top of the Day view. Your daily note opens, and under `## Schedule` you'll see something like:

```markdown
## Schedule
- 09:30 - 11:00 Deep work
	- [x] Outline chapter 2
```

This is all Kairos stores. You can edit it by hand too; the views update as you type.

## 6. Make a domain and a project

1. Open the hourglass menu and select **Projects & domains**.
2. Select **New domain**, name it "School", and select **Create**.
3. Right-click "School" and select **Add project**. Name it "Thesis".

## 7. Associate your block

1. Go back to the Day view and right-click your block.
2. Select **Add association**, type "Thesis", and press **Enter**.

The block's line in your note now ends in `[Thesis]`. Tasks inside the block belong to Thesis too, unless you give them an association of their own. A domain is written with a `D:`, like `[D:School]`.

## 8. Open the Grid

Open the hourglass menu and select **Grid**. Each row is a project or domain, and each column is a day. Your block and its tasks are in the Thesis row, under the block's time and title.

Try this:

- **Move a task to another day:** press and hold the task's text for a moment, then drag it to another column.
- **Schedule a task:** with the Day view open beside the Grid, drag a task from the Grid onto empty time in the Day view. Kairos makes a 30-minute block with the task inside.
- **Add a task to a block:** point at the top-right corner of the block's header in a cell and select **Add task to …**. The **+** in a cell's corner adds a task with no time yet.

When you work on a day in the Grid, the Day view follows along and shows that day.

## Things that are easy to miss

- **Point at a row's top-right corner** to see its actions. This works for tasks, blocks and backlog items.
- **Right-click** almost anything for more: a task, a block, a Grid row's label, a project.
- **Press and hold a task's text, then move,** to drag it. A quick click edits the text instead.
- **Hold Cmd while dropping** to copy instead of move.
- **Cmd+click** a date to open that day's note. Cmd+click a task's project to open the project's note.
- **Point at cut-off text** to read all of it.

## Where to next

- [Guide](guide.md): the backlog, routines, project focus, and everything else each view can do.
- [Reference](reference.md): the markdown format, every shortcut, and all settings.
