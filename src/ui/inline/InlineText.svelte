<script lang="ts">
	// One line of item text with its links and formatting drawn, as Obsidian
	// draws them in a note: [[links]], [text](url), bare URLs, `code`, bold,
	// italic, strikethrough, highlight and #tags (inline.ts reads them). It
	// draws no box of its own, so it sits inside whatever span clamps,
	// ellipsizes or strikes the text.
	//
	// Plain text, the common case, draws as a bare string. The pieces are
	// cached by text, so a row costs about what `{text}` did. Links behave as
	// in a note (links.ts) and a click or press on one stops there.

	import { isPlain, parseInline, type Inline } from "../../inline";
	import { isResolved, linkVersion, onLinkClick, onLinkHover, onLinkPress } from "./links";

	interface Props {
		text: string;
		// The note the text lives in, which note links resolve from.
		sourcePath?: string;
	}

	let { text, sourcePath = "" }: Props = $props();

	const pieces = $derived(parseInline(text));

	const click = (e: MouseEvent) => onLinkClick(e, sourcePath);
	const hover = (e: MouseEvent) => onLinkHover(e, sourcePath);
	// Reads `$linkVersion` so the style follows notes being created or renamed.
	const unresolved = (target: string, _version: number) => !isResolved(target, sourcePath);
</script>

{#snippet run(list: readonly Inline[])}
	{#each list as p, i (i)}
		{#if p.kind === "text"}{p.text}{:else if p.kind === "code"}<code>{p.text}</code
			>{:else if p.kind === "strong"}<strong>{@render run(p.children)}</strong
			>{:else if p.kind === "em"}<em>{@render run(p.children)}</em
			>{:else if p.kind === "del"}<del>{@render run(p.children)}</del
			>{:else if p.kind === "mark"}<mark>{@render run(p.children)}</mark
			>{:else if p.kind === "tag"}<a
				class="tag"
				href="#{p.tag}"
				data-tag={p.tag}
				draggable="false"
				onclick={click}
				onpointerdown={onLinkPress}
				onkeydown={onLinkPress}>#{p.tag}</a
			>{:else if p.kind === "internal"}<a
				class="internal-link"
				class:is-unresolved={unresolved(p.target, $linkVersion)}
				href={p.target}
				data-href={p.target}
				draggable="false"
				onclick={click}
				onauxclick={click}
				onpointerover={hover}
				onpointerdown={onLinkPress}
				onkeydown={onLinkPress}>{@render run(p.children)}</a
			>{:else if p.kind === "external"}<a
				class="external-link"
				href={p.url}
				target="_blank"
				rel="noopener nofollow"
				draggable="false"
				onclick={click}
				onpointerdown={onLinkPress}
				onkeydown={onLinkPress}>{@render run(p.children)}</a
			>{/if}
	{/each}
{/snippet}

{#if isPlain(pieces)}{pieces[0]?.kind === "text" ? pieces[0].text : ""}{:else}{@render run(pieces)}{/if}
