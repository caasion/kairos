import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only. The engine's pure core (parser, serializer, resolver, index)
// takes its Obsidian dependencies by injection, so these run in plain Node with
// no live app — never import `obsidian` from a *.test.ts file. A UI action the
// tests import may still reach for one of its helpers; `obsidian` resolves to
// a stub of those (src/testing/obsidianStub.ts).
export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("./src/testing/obsidianStub.ts", import.meta.url)),
		},
	},
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
