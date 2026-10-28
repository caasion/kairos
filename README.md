Seize the moment. Get things done.

[![Watch the 3-minute demo: planning a morning with Kairos](https://img.youtube.com/vi/4KXV-WIqeDw/maxresdefault.jpg)](https://www.youtube.com/watch?v=4KXV-WIqeDw)

*Watch the 3-minute demo: planning a morning with Kairos.*

Kairos is for people whose time isn't fully their own (students, employees, or anyone juggling shifting commitments) who need to decide how they spend their time before it's decided for them.

Kairos is a time-centric productivity app that helps you turn intentions into action. Most tools let tasks float in a backlog. Kairos doesn't. It asks one thing of you: decide *when* and *where* the work happens. That constraint is the whole point. A task you've placed in your day is a commitment; a task you haven't is just a wish.

![A daily note's markdown beside the Day view, editing one updates the other](https://raw.githubusercontent.com/caasion/kairos/main/docs/media/hero.gif)

Your day is built from time blocks, and work lives as tasks inside them. A real, complete day is stored in markdown:
```markdown
## Schedule
- 09:30 - 11:00 Deep Work [Kairos]
	- [ ] Rework the block parser
	- [x] Fix timeline scroll perf
- 11:00 - 12:30 Study [D:School]
	- [ ] Review linear algebra for the midterm
- 13:00 - 14:00 Swim [Fitness]
	- [x] Swim
	- Did 40 lengths
```

Your notes remain the source of truth, and they stay readable with or without Kairos.

The key philosophy:
- **Time belongs to blocks; work belongs to tasks.** A block owns a span of your day. Tasks inside it are what you're actually doing. This split is why Kairos can tell you where your hours went and what's left to do, without the two ever getting tangled.
- **Association is optional context, not structure.** A task can belong to a project or a domain, but it never has to. Projects group related work; domains map to the broader areas of your life. They're lenses for seeing your tasks, not folders you're forced to file into before you can act.
- **Everything is derived.** All pages and views are views computed from your daily notes. You plan in one place, and Kairos connects it all together.

## The views

Select the hourglass icon in the ribbon to open any of them.

- **Day** and **Week**: your timeline. Drag on empty time to make a block, then add tasks inside it.
  ![Drag out a block, rename it, add tasks, check one off](https://raw.githubusercontent.com/caasion/kairos/main/docs/media/day-blocks.gif)
- **Grid**: one row per project or domain, one column per day. Triage what you're doing and when, then drag tasks onto the timeline to schedule them.
  ![Drag a task to another day, then to another row](https://raw.githubusercontent.com/caasion/kairos/main/docs/media/grid-drag.gif)
  ![Drag a Grid task onto empty time in the Day view](https://raw.githubusercontent.com/caasion/kairos/main/docs/media/grid-to-timeline.gif)
- **Backlog**: intentions you haven't scheduled yet. Give one a resurface date and it shows up in your day when it's time.
  ![A resurfaced item, then the arrow schedules it](https://raw.githubusercontent.com/caasion/kairos/main/docs/media/backlog-nudge.gif)
- **Routines**: blocks and tasks that repeat. Kairos offers the missing ones each day; you add them on purpose.
  ![The routines pill on a column header, then Add all](https://raw.githubusercontent.com/caasion/kairos/main/docs/media/routines.gif)
- **Projects & domains**: create and organise what your work belongs to, and record when you're focused on each.
- **Timeline**: which projects were active when, and how hard you pushed them.
  ![Set a bar's intensity with the pips](https://raw.githubusercontent.com/caasion/kairos/main/docs/media/timeline-intensity.gif)

## Get started

1. Install Kairos from **Settings → Community plugins → Browse**, then enable it.
2. Make sure daily notes are set up (**Settings → Daily notes**, or the Periodic Notes plugin). Kairos uses the same folder and date format.
3. Select the hourglass icon in the ribbon and open **Day**. Drag down on empty time to make your first block.

The [Getting started guide](docs/getting-started.md) walks through your first day, step by step.

## Documentation

- [Getting started](docs/getting-started.md): set up Kairos and plan your first day.
- [Guide](docs/guide.md): how to do things in each view.
- [Reference](docs/reference.md): the markdown format, every mouse and keyboard shortcut, and all settings.

Kairos is desktop-first. It runs on mobile, but some actions need a right-click or a keyboard.
