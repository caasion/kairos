import { describe, expect, it } from "vitest";
import { NormalizationDeclines, declineKey } from "./statusNormalization";
import type { DeclineStore } from "./statusNormalization";
import type { Domain, Project } from "./types";

/**
 * An in-memory `DeclineStore`. Reloading from the same instance is the test for
 * durability that matters: the whole point of #28 is that "leave it alone"
 * survives the next read of the file, which in the app is a new session reading
 * the same JSON back off disk.
 */
function memoryStore(initial: string | null = null) {
	let text = initial;
	const writes: string[] = [];
	const store: DeclineStore = {
		read: () => Promise.resolve(text),
		write: (t) => {
			text = t;
			writes.push(t);
			return Promise.resolve();
		},
	};
	return { store, writes, current: () => text };
}

const entity = (over: Partial<Project> = {}): Project => ({
	id: "alpha-1",
	name: "Alpha",
	aliases: [],
	description: "",
	history: [],
	archived: false,
	source: { path: "Projects/Alpha.md", line: 0 },
	...over,
});

describe("NormalizationDeclines", () => {
	it("starts empty when nothing has been stored", async () => {
		const declines = await NormalizationDeclines.load(memoryStore().store);
		expect(declines.keys()).toEqual([]);
		expect(declines.has("id:alpha-1")).toBe(false);
	});

	it("remembers a decline across a reload — the offer does not come back", async () => {
		const { store } = memoryStore();
		const first = await NormalizationDeclines.load(store);
		await first.decline("id:alpha-1");
		expect(first.has("id:alpha-1")).toBe(true);

		// A fresh load: the next session, reading the same file.
		const second = await NormalizationDeclines.load(store);
		expect(second.has("id:alpha-1")).toBe(true);
		expect(second.has("id:bravo-2")).toBe(false);
	});

	it("writes once per distinct decline", async () => {
		const { store, writes } = memoryStore();
		const declines = await NormalizationDeclines.load(store);
		await declines.decline("id:alpha-1");
		await declines.decline("id:alpha-1");
		expect(writes).toHaveLength(1);
		await declines.decline("path:Projects/Bravo.md");
		expect(writes).toHaveLength(2);
		expect(declines.keys()).toEqual(["id:alpha-1", "path:Projects/Bravo.md"]);
	});

	it("stores the whole list every time, so a crash can't leave it half-written", async () => {
		const { store, current } = memoryStore();
		const declines = await NormalizationDeclines.load(store);
		await declines.decline("id:alpha-1");
		await declines.decline("id:bravo-2");
		expect(JSON.parse(current() ?? "")).toEqual({
			version: 1,
			declined: ["id:alpha-1", "id:bravo-2"],
		});
	});

	it.each([
		["not json at all", "{{{"],
		["an empty file", ""],
		["a foreign shape", '{"something": "else"}'],
		["a non-array list", '{"version":1,"declined":"id:alpha-1"}'],
		["a null document", "null"],
	])("reads %s as nothing declined rather than throwing", async (_label, text) => {
		const declines = await NormalizationDeclines.load(memoryStore(text).store);
		expect(declines.keys()).toEqual([]);
	});

	it("keeps only the string entries of a mixed list", async () => {
		const declines = await NormalizationDeclines.load(
			memoryStore('{"version":1,"declined":["id:alpha-1",7,null,"path:x.md"]}').store,
		);
		expect(declines.keys()).toEqual(["id:alpha-1", "path:x.md"]);
	});

	it("resolves empty when the store itself fails to read", async () => {
		const failing: DeclineStore = {
			read: () => Promise.reject(new Error("disk gone")),
			write: () => Promise.resolve(),
		};
		const declines = await NormalizationDeclines.load(failing);
		expect(declines.keys()).toEqual([]);
	});

	it("propagates a failed write and does not pretend the decline stuck", async () => {
		const failing: DeclineStore = {
			read: () => Promise.resolve(null),
			write: () => Promise.reject(new Error("read-only vault")),
		};
		const declines = await NormalizationDeclines.load(failing);
		await expect(declines.decline("id:alpha-1")).rejects.toThrow();
		// Memory agrees with disk: a decline that never landed is not remembered,
		// so the offer stays up now instead of reappearing unexplained later.
		expect(declines.has("id:alpha-1")).toBe(false);
	});
});

describe("declineKey", () => {
	it("files a decline under the frontmatter id, so a rename doesn't re-ask", () => {
		expect(declineKey(entity())).toBe("id:alpha-1");
	});

	it("falls back to the path when the file carries no id", () => {
		expect(declineKey(entity({ id: "" }))).toBe("path:Projects/Alpha.md");
	});

	it("works the same for a domain", () => {
		const domain: Domain = {
			id: "",
			name: "Health",
			aliases: [],
			description: "",
			order: 0,
			color: "",
			history: [],
			archived: false,
			source: { path: "Domains/Health.md", line: 0 },
		};
		expect(declineKey(domain)).toBe("path:Domains/Health.md");
		expect(declineKey({ ...domain, id: "track-8" })).toBe("id:track-8");
	});
});
