#!/usr/bin/env node
// Build a demo vault for trying Kairos in Obsidian.
//
//   npm run demo-vault                      builds ./demo-vault for today
//   npm run demo-vault -- --reset           rebuilds it (run it again on a new day)
//   npm run demo-vault -- ~/Vaults/Kairos   builds somewhere else
//
// Options:
//   --reset             replace the notes this script made, and Kairos's settings
//   --today YYYY-MM-DD  pretend today is another date
//   --copy              copy the build into the vault instead of linking it
//
// Every date is relative to today, because Kairos's views open on today: two
// weeks of finished days, today half done, and two days planned ahead. There are
// three domains (one with no projects yet), six projects (one rolled into its
// domain, one finished, one archived), routines, and a backlog with resurface
// dates.
//
// The plugin folder links to this repo's main.js, manifest.json and styles.css,
// so a rebuild from `npm run dev` shows up after reloading Obsidian. Where links
// can't be made (Windows without developer mode) the files are copied, and you
// run this again with --reset after each build.
//
// demoVaultFiles() is pure so src/demoVault.test.ts can check that Kairos's own
// parsers read every note it makes.

import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_FILES = ["main.js", "manifest.json", "styles.css"];
/** Top-level paths this script owns. --reset deletes exactly these. */
export const GENERATED = ["Daily", "Projects", "Domains", "Backlog.md", "Routines.md"];

// ─── dates ─────────────────────────────────────────────────────

/** @param {string} iso @param {number} days */
function shift(iso, days) {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. @param {string} iso */
function weekday(iso) {
	return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function localToday() {
	const d = new Date();
	const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── markdown pieces ───────────────────────────────────────────

/** @param {string} status @param {string} text @param {string} [assoc] */
const task = (status, text, assoc = "") => `\t- [${status}] ${text}${assoc ? ` ${assoc}` : ""}`;

/** @param {string} start @param {string} end @param {string} title @param {string} assoc @param {string[]} lines */
const block = (start, end, title, assoc, lines) =>
	[`- ${start} - ${end} ${title}${assoc ? ` ${assoc}` : ""}`, ...lines].join("\n");

/** @param {string[]} blocks @param {string[]} unscheduled */
const dayNote = (blocks, unscheduled) =>
	`## Schedule\n\n${["- Unscheduled", ...unscheduled, ...blocks].join("\n")}\n`;

/**
 * @typedef {{ status: "active" | "inactive" | "archived", intensity?: number, note?: string, why?: string }} StatusRecord
 * @param {[string, StatusRecord][]} records
 */
function statusYaml(records) {
	const lines = ["status:"];
	for (const [date, rec] of records) {
		lines.push(`  ${date}:`, `    status: ${rec.status}`);
		if (rec.intensity !== undefined) lines.push(`    intensity: ${rec.intensity}`);
		if (rec.note !== undefined) lines.push(`    note: ${JSON.stringify(rec.note)}`);
		if (rec.why !== undefined) lines.push(`    why: ${JSON.stringify(rec.why)}`);
	}
	return lines.join("\n");
}

/** @param {string} id @param {string | null} domainId @param {[string, StatusRecord][]} records @param {{ rollup?: boolean, description?: string }} [opts] */
function projectFile(id, domainId, records, opts = {}) {
	return [
		"---",
		"tags:",
		"  - kairos/project",
		`id: ${id}`,
		"aliases: []",
		`description: ${JSON.stringify(opts.description ?? "")}`,
		...(domainId ? [`domain_id: ${domainId}`] : []),
		...(opts.rollup ? ["rollup: true"] : []),
		statusYaml(records),
		"---",
		"",
	].join("\n");
}

/** @param {string} id @param {string} color @param {number} order @param {string} since */
function domainFile(id, color, order, since) {
	return [
		"---",
		"tags:",
		"  - kairos/domain",
		`id: ${id}`,
		"aliases: []",
		'description: ""',
		`order: ${order}`,
		`color: "${color}"`,
		statusYaml([[since, { status: "active" }]]),
		"---",
		"",
	].join("\n");
}

// ─── content ───────────────────────────────────────────────────

const DOMAINS = [
	// name, id, colour, order
	["School", "sch00l01", "#3b82f6", 1],
	["Health", "he4lth01", "#22c55e", 2],
	["Life", "l1fe0001", "#f97316", 3],
	// No projects and no tasks yet: an empty row in the Grid.
	["Work", "w0rk0001", "#a855f7", 4],
];

const ROUTINES = `## Weekdays
- 07:30 - 08:00 Morning Routine [D:Health]
	- [ ] Take meds
- 12:30 - 13:15 Lunch [D:Life]
- 18:00 - 19:00 Gym [D:Health] 🔁 Tue, Thu
	- [ ] Gym

## Daily
- Unscheduled
	- [ ] Water the plants [D:Life]
`;

const THESIS = [
	"Read Chen et al. 2023", "Annotate the survey paper", "Outline chapter 2",
	"Draft 2.1 Background", "Make figure 2.1", "Fix citations in chapter 1",
	"Draft 2.2 Related work", "Revise 2.1 from feedback", "Draft 2.3 Methods overview",
	"Tighten the chapter 2 intro",
];
const LINALG = [
	"Problem set 5, Q1–4", "Problem set 5, Q5–8", "Review eigenvalues",
	"Watch lecture 14", "Problem set 6, Q1–3", "Review diagonalisation",
	"Practice midterm, part A", "Watch lecture 15", "Problem set 6, Q4–6",
	"Office hours: ask about Q7",
];

/** The routine blocks for a day, written the way Kairos writes them. @param {string} d @param {boolean} done */
function routinesFor(d, done) {
	const s = done ? "x" : " ";
	/** @type {[string, string][]} */
	const out = [];
	if (weekday(d) < 5) {
		out.push(["07:30", block("07:30", "08:00", "Morning Routine", "[D:Health]", [task(s, "Take meds")])]);
		out.push(["12:30", block("12:30", "13:15", "Lunch", "[D:Life]", [])]);
		if (weekday(d) === 1 || weekday(d) === 3) {
			out.push(["18:00", block("18:00", "19:00", "Gym", "[D:Health]", [task(s, "Gym")])]);
		}
	}
	return out;
}

/** @param {[string, string][]} b */
const sorted = (b) => b.sort((x, y) => x[0].localeCompare(y[0])).map((x) => x[1]);

/** A finished day, `-o` days before today. @param {string} d @param {number} o */
function pastDay(d, o) {
	const i = -o;
	const b = routinesFor(d, true);
	const wd = weekday(d);
	if (wd < 5) {
		const thesis = [task("x", THESIS[i % 10]), task(i % 3 === 0 ? "/" : "x", THESIS[(i + 3) % 10])];
		// A note: a bullet under a block with no checkbox.
		if (i % 3 === 0) thesis.push("\t- Got through half of it");
		b.push(["09:00", block("09:00", "10:30", "Thesis writing", "[Thesis]", thesis)]);
		if (wd === 0 || wd === 2 || wd === 4) {
			b.push(["10:45", block("10:45", "11:45", "Linear Algebra lecture", "[Linear Algebra]", [task("x", LINALG[(i + 3) % 10])])]);
		}
		if (o >= -10 && o <= -8) {
			b.push(["14:00", block("14:00", "16:30", "Hackathon build", "[Hackathon]", [
				task("x", ["Wire up the API", "Build the dashboard", "Fix the login bug"][i % 3]),
				task(i % 2 ? "x" : "-", ["Write the pitch", "Record the demo", "Polish the landing page"][i % 3]),
			])]);
		} else if (o === -7) {
			b.push(["14:00", block("14:00", "15:00", "Hackathon submission", "[Hackathon]", [
				task("x", "Submit on Devpost"), "\t- Made it with 20 minutes to spare",
			])]);
		} else if (o <= -12) {
			b.push(["14:00", block("14:00", "15:30", "Club website", "[Robotics Club]", [
				task("x", ["Move the events page", "Fix the sign-up form"][i % 2]),
			])]);
		} else {
			b.push(["14:00", block("14:00", "15:30", "Problem set", "[Linear Algebra]", [
				task("x", LINALG[i % 10]), task(i % 4 ? "x" : "-", LINALG[(i + 5) % 10]),
			])]);
		}
		if (o >= -3) {
			b.push(["19:30", block("19:30", "21:00", "Thesis evening push", "[Thesis]", [task("x", THESIS[(i + 6) % 10])])]);
		}
	} else {
		b.push(["09:00", block("09:00", "10:00", "Long run", "[Running]", [task("x", i % 2 ? "8 km easy" : "5 km tempo")])]);
		b.push(["11:00", block("11:00", "11:45", "Groceries", "[Groceries]", [task("x", "Oats, eggs, spinach, rice")])]);
		b.push(["14:00", block("14:00", "16:00", "Thesis writing", "[Thesis]", [task("x", THESIS[(i + 1) % 10])])]);
	}
	if (o === -1) {
		// Unfinished tasks, for today's "Left from" list.
		b.push(["16:00", block("16:00", "17:00", "Admin", "[D:School]", [
			task("x", "Book a room for the study group"),
			task(" ", "Email Prof. Lin about the chapter 2 outline", "[Thesis]"),
			task("/", "Problem set 6, Q4–6", "[Linear Algebra]"),
		])]);
	}
	return dayNote(sorted(b), [task("x", "Water the plants", "[D:Life]")]);
}

/** Today: half done, routines already in. @param {string} d */
function today(d) {
	const b = routinesFor(d, false).map(([t, x]) => /** @type {[string, string]} */ ([t, x.replace("[ ] Take meds", "[x] Take meds")]));
	b.push(["09:00", block("09:00", "11:00", "Thesis writing", "[Thesis]", [
		task("x", "Outline section 2.3"), task(" ", "Rewrite the methods intro"),
	])]);
	b.push(["16:00", block("16:00", "17:00", "Problem set", "[Linear Algebra]", [task(" ", "Problem set 7, Q1–3")])]);
	return dayNote(sorted(b), [task(" ", "Water the plants", "[D:Life]")]);
}

/** Tomorrow: no routines yet, so the routines pill shows on its column. */
function tomorrow() {
	return dayNote(
		[block("10:00", "11:30", "Linear Algebra lecture", "[Linear Algebra]", [task(" ", "Bring the practice midterm")])],
		[task(" ", "Read Strang chapter 6", "[Linear Algebra]"), task(" ", "Send the chapter 2 draft to Sam", "[Thesis]")],
	);
}

/** @param {string} d */
function dayAfter(d) {
	const b = routinesFor(d, false);
	b.push(["09:00", block("09:00", "11:00", "Thesis writing", "[Thesis]", [task(" ", "Draft 2.4 Evaluation plan")])]);
	// More tasks than 30 minutes can show: "N more" in the Week view.
	b.push(["14:00", block("14:00", "14:30", "Errands", "[D:Life]", [
		task(" ", "Pick up the parcel"), task(" ", "Return library books"),
		task(" ", "Buy printer paper"), task(" ", "Drop off recycling"),
	])]);
	return dayNote(sorted(b), [task(" ", "Water the plants", "[D:Life]")]);
}

/**
 * Every note in the demo vault, keyed by vault path.
 * @param {string} T today, as YYYY-MM-DD
 * @returns {Record<string, string>}
 */
export function demoVaultFiles(T) {
	const D = (/** @type {number} */ n) => shift(T, n);
	/** @type {Record<string, string>} */
	const files = {};
	const ids = Object.fromEntries(DOMAINS.map(([name, id]) => [name, id]));

	for (const [name, id, color, order] of DOMAINS) {
		files[`Domains/${name}.md`] = domainFile(String(id), String(color), Number(order), D(name === "Work" ? -5 : -60));
	}

	files["Projects/Thesis.md"] = projectFile("th3s1s01", ids.School, [
		[D(-14), { status: "active", intensity: 3, note: "Draft chapter 2" }],
		[D(-3), { status: "active", intensity: 5, note: "Deadline Friday" }],
	], { description: "Master's thesis, chapter 2 this month" });
	files["Projects/Linear Algebra.md"] = projectFile("l1nalg01", ids.School, [
		[D(-14), { status: "active", intensity: 2, note: "Keep up with the problem sets" }],
	]);
	files["Projects/Hackathon.md"] = projectFile("h4ckat01", null, [
		[D(-14), { status: "active", intensity: 4, note: "Ship the demo" }],
		[D(-7), { status: "inactive", why: "Submitted!" }],
	]);
	files["Projects/Running.md"] = projectFile("runn1ng1", ids.Health, [
		[D(-30), { status: "active", intensity: 2 }],
	]);
	files["Projects/Groceries.md"] = projectFile("gr0cer01", ids.Life, [
		[D(-60), { status: "active" }],
	], { rollup: true });
	files["Projects/Robotics Club.md"] = projectFile("r0b0tc01", ids.School, [
		[D(-45), { status: "active", intensity: 1 }],
		[D(-11), { status: "archived", why: "Handed the website over" }],
	]);

	for (let o = -14; o < 0; o++) files[`Daily/${D(o)}.md`] = pastDay(D(o), o);
	files[`Daily/${T}.md`] = today(T);
	files[`Daily/${D(1)}.md`] = tomorrow();
	files[`Daily/${D(2)}.md`] = dayAfter(D(2));

	files["Routines.md"] = ROUTINES;
	files["Backlog.md"] = [
		`- Renew library books [D:Life] 📅 ${T}`,
		"- Book a dentist appointment [D:Health]",
		`- Start the related-work survey [Thesis] 📅 ${D(7)}`,
		"- Read Deep Work [D:Life]",
		"- Try the new climbing gym [D:Health]",
		"- Clean up the hackathon repo [Hackathon]",
		"- Fix the bike's back brake [Running]",
		"- Plan a winter running route [Running]",
		"- Update my CV",
	].join("\n") + "\n";

	return files;
}

// ─── writing the vault ─────────────────────────────────────────

/** @param {string} path @param {string} text */
function write(path, text) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

/** @param {string} path */
function exists(path) {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const opts = { dir: join(REPO, "demo-vault"), today: localToday(), reset: false, copy: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--reset") opts.reset = true;
		else if (a === "--copy") opts.copy = true;
		else if (a === "--today") opts.today = argv[++i] ?? "";
		else if (a === "--help" || a === "-h") {
			console.log("Usage: npm run demo-vault -- [folder] [--reset] [--today YYYY-MM-DD] [--copy]");
			process.exit(0);
		} else if (a?.startsWith("--")) throw new Error(`Unknown option ${a}`);
		else if (a) opts.dir = resolve(a);
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) throw new Error("--today takes a date like 2026-11-07");
	return opts;
}

function main() {
	const { dir, today: T, reset, copy } = parseArgs(process.argv.slice(2));

	if (GENERATED.some((g) => exists(join(dir, g)))) {
		if (!reset) {
			console.error(`${dir} already has demo notes. Run again with --reset to rebuild them for ${T}.`);
			process.exit(1);
		}
		for (const g of GENERATED) rmSync(join(dir, g), { recursive: true, force: true });
	}

	for (const [path, text] of Object.entries(demoVaultFiles(T))) write(join(dir, path), text);

	// Obsidian: Daily notes on, Kairos the only community plugin. Files a person
	// may have changed in Obsidian (core plugins, app settings, layout) are only
	// written when missing.
	const obs = join(dir, ".obsidian");
	write(join(obs, "daily-notes.json"), JSON.stringify({ folder: "Daily", format: "YYYY-MM-DD" }, null, 2));
	write(join(obs, "community-plugins.json"), JSON.stringify(["kairos"]));
	if (!existsSync(join(obs, "core-plugins.json"))) {
		const core = ["file-explorer", "global-search", "switcher", "backlink", "outgoing-link", "tag-pane",
			"properties", "page-preview", "daily-notes", "command-palette", "editor-status", "outline", "file-recovery"];
		write(join(obs, "core-plugins.json"), JSON.stringify(Object.fromEntries(core.map((k) => [k, true])), null, 2));
	}
	if (!existsSync(join(obs, "app.json"))) write(join(obs, "app.json"), "{}");

	// Kairos's settings. The tour is marked done so it doesn't open on every
	// rebuild; run "Kairos: Start tour" to see it.
	const plugin = join(obs, "plugins", "kairos");
	write(join(plugin, "data.json"), JSON.stringify({
		timelineStartHour: 7,
		timelineEndHour: 22,
		autoApplyRoutines: false,
		highlightAcrossViews: true,
		tour: { status: "done", step: 0 },
	}, null, 2));

	let copied = copy;
	for (const f of BUILD_FILES) {
		const src = join(REPO, f);
		const dest = join(plugin, f);
		rmSync(dest, { force: true });
		if (!copied) {
			try {
				symlinkSync(relative(plugin, src), dest);
				continue;
			} catch {
				copied = true;
			}
		}
		if (existsSync(src)) copyFileSync(src, dest);
	}

	console.log(`Built the demo vault for ${T} at ${dir}`);
	if (!existsSync(join(REPO, "main.js"))) {
		console.log("There's no main.js yet: run `npm run dev` (or `npm run build`) before opening the vault.");
	}
	console.log(copied
		? "The build was copied in, so run this again with --reset after each build."
		: "The plugin folder links to this repo's build, so `npm run dev` changes show after reloading Obsidian.");
	console.log("Open the folder in Obsidian (Open another vault → Open folder as vault) and trust the author to enable Kairos.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (e) {
		console.error(e instanceof Error ? e.message : e);
		process.exit(1);
	}
}
