<script lang="ts">
  import { MathSlotStudio } from '@mathslot/ui';
  import { createWebHost } from './webHost';

  const host = createWebHost();
</script>

<main class="web-root">
  <MathSlotStudio {host} />
</main>

<style>
  :global(html, body, #app) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .web-root {
    width: 100%;
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
</style>
