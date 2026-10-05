import obsidianmd from 'eslint-plugin-obsidianmd';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';
import type { Linter } from 'eslint';

const TS_GLOB = '**/*.{ts,cts,mts,tsx}';
const SVELTE_FILES = ['**/*.svelte'];

// eslint-plugin-obsidianmd scopes its TypeScript blocks (typescript-eslint
// recommended-type-checked, no-unsanitized, sdl, import, ...) to TS_GLOB.
// Re-apply those same blocks to .svelte files so the rules run inside
// <script lang="ts">. The parser is dropped from the copies because .svelte
// files are parsed by svelte-eslint-parser (configured below), which hands
// the <script> contents to the typescript-eslint parser.
const obsidianTsBlocksForSvelte = (
	obsidianmd.configs.recommended as Linter.Config[]
)
	.filter((c) => Array.isArray(c.files) && c.files.flat().includes(TS_GLOB))
	.map((c, i): Linter.Config => {
		const { parser: _parser, ...languageOptions } = c.languageOptions ?? {};
		return {
			...c,
			name: `${c.name ?? `obsidianmd/ts-block-${i}`} (svelte)`,
			files: SVELTE_FILES,
			languageOptions,
		};
	});

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'stylelint.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						'vitest.config.mts',
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json', '.svelte'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	...svelte.configs.recommended,
	...obsidianTsBlocksForSvelte,
	{
		files: SVELTE_FILES,
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tseslint.parser,
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.svelte'],
			},
		},
		rules: {
			// Accessibility. eslint-plugin-svelte has no a11y rules of its own;
			// Svelte 5's a11y checks are compiler warnings (a11y_*), surfaced
			// here through svelte/valid-compile. Those are the same checks
			// svelte-check runs, but CI only runs build + lint, so without this
			// nothing enforces them. The tree is currently clean (0 compiler
			// warnings with the existing `svelte-ignore a11y_*` comments
			// honoured), so this is an error: new a11y regressions must either
			// be fixed or carry an explicit, reviewable svelte-ignore. To relax
			// a specific a11y_* code later, add a `warningFilter` in a
			// svelte.config.js rather than downgrading this rule wholesale.
			// svelte/no-unused-svelte-ignore (below) keeps those ignores honest.
			'svelte/valid-compile': 'error',
		},
	},
	{
		// First-run findings, downgraded to warnings so this config can land
		// without a mass edit of .svelte files that several open PRs are
		// rewriting. Each is a follow-up for #32; move a rule back to error
		// (by deleting its line) once its warnings are fixed. Scoped to .svelte
		// only: these rules stay errors in .ts files.
		files: SVELTE_FILES,
		rules: {
			// Mostly `any` leaking across component boundaries: typescript-eslint
			// cannot see a child component's prop types (svelte2tsx is not in
			// the loop), so callback params such as `onGrab={(e) => ...}` and
			// bind:this instances are `any`. Datepicker.svelte has genuinely
			// untyped $props().
			'@typescript-eslint/no-unsafe-argument': 'warn',
			'@typescript-eslint/no-unsafe-assignment': 'warn',
			'@typescript-eslint/no-unsafe-call': 'warn',
			'@typescript-eslint/no-unsafe-member-access': 'warn',
			'@typescript-eslint/no-unsafe-return': 'warn',
			'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/await-thenable': 'warn',
			'obsidianmd/no-static-styles-assignment': 'warn',
			'svelte/require-each-key': 'warn',
			'svelte/no-unused-svelte-ignore': 'warn',
			'svelte/prefer-svelte-reactivity': 'warn',
			'svelte/prefer-writable-derived': 'warn',
			'svelte/no-dom-manipulating': 'warn',
			'svelte/no-unused-props': 'warn',
		},
	},
	{
		// The engine runs in plain Node under vitest and must not reference
		// `window`. Its debounce timers live for the plugin's lifetime and are
		// cleared in dispose(), so popout-window compatibility does not apply.
		// Auto-fixing these breaks both the unit tests and tsc's timer typing.
		files: ['src/index.ts'],
		rules: { 'obsidianmd/prefer-window-timers': 'off' },
	},
);
