<!--
  Renders its children into a target element (default <body>), escaping any
  clipping/stacking context of the component that mounts it. Ported from Holos.
-->
<script lang="ts">
  import { onMount } from "svelte";

  let { target = "body", children }: { target?: string; children: any } = $props();

  let portalTarget: Element | null = null;
  let portalEl: HTMLDivElement | undefined = $state();

  onMount(() => {
    portalTarget = document.querySelector(target);
    if (portalTarget && portalEl) {
      portalTarget.appendChild(portalEl);
    }
    return () => {
      portalEl?.remove();
    };
  });
</script>

<div bind:this={portalEl} class="svelte-portal">
  {@render children()}
</div>

<style>
  .svelte-portal {
    display: contents;
  }
</style>
