// Correctness only, no formatting or style rules: the goal is to catch CSS
// that browsers silently drop (typos in properties/values, bad units, broken
// hex colours), which build, eslint, tests and svelte-check all miss. See #32.
// stylelint-config-html/svelte supplies postcss-html as the customSyntax for
// .svelte files so their <style> blocks are linted too.
/** @type {import('stylelint').Config} */
export default {
	extends: ['stylelint-config-html/svelte'],
	rules: {
		'property-no-unknown': true,
		'declaration-property-value-no-unknown': true,
		'declaration-block-no-duplicate-properties': [
			true,
			{ ignore: ['consecutive-duplicates-with-different-syntaxes'] },
		],
		'declaration-block-no-shorthand-property-overrides': true,
		'color-no-invalid-hex': true,
		'unit-no-unknown': true,
		'function-no-unknown': true,
		'string-no-newline': true,
		'no-invalid-double-slash-comments': true,
		'at-rule-no-unknown': true,
		'media-feature-name-no-unknown': true,
		'selector-pseudo-element-no-unknown': true,
		// Svelte's scoping escape hatch.
		'selector-pseudo-class-no-unknown': [
			true,
			{ ignorePseudoClasses: ['global'] },
		],
		'selector-type-no-unknown': [true, { ignore: ['custom-elements'] }],
		'keyframe-declaration-no-important': true,
	},
};
