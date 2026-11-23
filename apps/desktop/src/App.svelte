<script lang="ts">
  import { MathSlotStudio } from '@mathslot/ui';
  import { createDesktopHost } from './desktopHost';

  const host = createDesktopHost();
</script>

<MathSlotStudio {host} />
