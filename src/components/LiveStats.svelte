<script>
  import { untrack } from 'svelte'
  import { onMount } from 'svelte'
  import { io } from 'socket.io-client'
  import { num } from '@/lib/electricity'

  let { socketUrl, pvPowerKw, batterySoc, gridPowerKw } = $props()
  // ponytail: untrack = intentional initial-value-only capture; socket overrides these
  let pv = $state(untrack(() => pvPowerKw))
  let soc = $state(untrack(() => batterySoc))
  let grid = $state(untrack(() => gridPowerKw))

  onMount(() => {
    const socket = io(socketUrl, { transports: ['websocket'] })
    socket.on('live', (data) => {
      pv = data.pvPowerKw
      soc = data.batterySoc
      grid = data.gridPowerKw
    })
    return () => socket.disconnect()
  })
</script>

<dl class="grid grid-cols-3 gap-6 md:gap-10">
  <div class="flex flex-col gap-2">
    <span class="text-[10px] uppercase tracking-luxury text-muted-foreground">ผลิตตอนนี้</span>
    <span class="font-serif text-3xl font-light text-foreground md:text-4xl">
      {num(pv, 1)}<span class="align-top text-base text-muted-foreground"> kW</span>
    </span>
  </div>
  <div class="flex flex-col gap-2">
    <span class="text-[10px] uppercase tracking-luxury text-muted-foreground">แบตเตอรี่</span>
    <span class="font-serif text-3xl font-light text-foreground md:text-4xl">
      {soc}<span class="align-top text-base text-muted-foreground">%</span>
    </span>
  </div>
  <div class="flex flex-col gap-2">
    <span class="text-[10px] uppercase tracking-luxury text-muted-foreground">ซื้อไฟ</span>
    <span class="font-serif text-3xl font-light text-foreground md:text-4xl">
      {num(grid, 1)}<span class="align-top text-base text-muted-foreground"> kW</span>
    </span>
  </div>
</dl>
