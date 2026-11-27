<script lang="ts">
  import { MathRibbon } from '@mathslot/ui';
  import type { InlineSplitWorkbenchStore } from './InlineSplitStore.svelte';

  interface Props {
    store: InlineSplitWorkbenchStore;
  }

  let { store }: Props = $props();

  const leaderActive = $derived(store.snapshot.mode.kind === 'leader');
  const leaderPrefix = $derived(
    store.snapshot.mode.kind === 'leader' ? store.snapshot.mode.prefix : '',
  );
  const pendingDefaultId = $derived(
    store.snapshot.mode.kind === 'leader' ? store.snapshot.mode.pendingDefaultId : undefined,
  );
</script>

<div
  class="ms-studio mathslot-split-panel mathslot-split-bottom"
  data-theme={store.dark ? 'dark' : 'light'}
>
  <MathRibbon
    leaderKey={store.settings.leaderKey}
    {leaderActive}
    {leaderPrefix}
    {pendingDefaultId}
    commands={store.effectiveCommands}
    customCommands={store.customCommands}
    snippets={store.snippets}
    popoverDirection="down"
    onInsertCommand={store.handleInsertCommand}
    onInsertSnippet={store.handleInsertSnippet}
    onSelectSubmenuKey={store.handleSelectSubmenuKey}
    onLeaderBack={store.handleLeaderBack}
  />
</div>
