import { defineConfig } from "vitest/config";

// Unit tests only. The engine's pure core (parser, serializer, resolver, index)
// takes its Obsidian dependencies by injection, so these run in plain Node with
// no live app — never import `obsidian` from a *.test.ts file.
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
