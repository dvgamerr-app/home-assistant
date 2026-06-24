<script lang="ts">
  import { untrack, onMount } from 'svelte'
  import { io } from 'socket.io-client'
  import { num } from '@/lib/electricity'
  import type { LiveSnapshot } from '@/lib/db'
  import Sun from '@lucide/svelte/icons/sun'
  import BatteryCharging from '@lucide/svelte/icons/battery-charging'
  import Battery from '@lucide/svelte/icons/battery'
  import House from '@lucide/svelte/icons/house'
  import Zap from '@lucide/svelte/icons/zap'

  let { live: init, socketUrl }: { live: LiveSnapshot; socketUrl: string } = $props()

  let pv = $state(untrack(() => init.pvPowerKw))
  let load = $state(untrack(() => init.loadPowerKw))
  let battPower = $state(untrack(() => init.batteryPowerKw))
  let soc = $state(untrack(() => init.batterySoc))
  let grid = $state(untrack(() => init.gridPowerKw))
  let svgEl: SVGSVGElement | undefined
  let containerEl: HTMLElement | undefined
  let svgW = $state(0)
  let connected = $state(false)
  const svgH = $derived(svgW ? Math.round((svgW * 380) / 360) : 0)

  const timers: Record<string, ReturnType<typeof setInterval>> = {}
  function animateTo(key: string, getter: () => number, setter: (v: number) => void, target: number, step: number) {
    clearInterval(timers[key])
    let cur = getter()
    if (Math.abs(target - cur) <= step) {
      setter(target)
      return
    }
    const dir = Math.sign(target - cur)
    timers[key] = setInterval(() => {
      cur += dir * step
      if (dir * (cur - target) >= 0) {
        setter(target)
        clearInterval(timers[key])
      } else setter(step < 1 ? +cur.toFixed(2) : Math.round(cur))
    }, 16)
  }

  // sign convention (per real inverter data): battPower < 0 = charging, grid < 0 = buying from grid
  const producing = $derived(pv > 0.05)
  const charging = $derived(battPower < -0.05) // solar surplus → battery
  const discharging = $derived(battPower > 0.05) // battery supplements home
  const importing = $derived(grid < -0.05) // grid supplies home

  const durN = (kw: number) => Math.max(0.8, 2.4 - Math.abs(kw) * 0.4)
  const dur = (kw: number) => `${durN(kw).toFixed(1)}s`
  const begin = (kw: number, i: number) => `${((i * durN(kw)) / 3).toFixed(2)}s`

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) svgEl?.pauseAnimations()
    const socket = io(socketUrl, { transports: ['websocket'] })
    socket.on('connect', () => {
      connected = true
    })
    socket.on('disconnect', () => {
      connected = false
    })
    socket.on('live', (data: LiveSnapshot) => {
      animateTo(
        'pv',
        () => pv,
        (v) => {
          pv = v
        },
        data.pvPowerKw,
        0.01,
      )
      animateTo(
        'load',
        () => load,
        (v) => {
          load = v
        },
        data.loadPowerKw,
        0.01,
      )
      animateTo(
        'batt',
        () => battPower,
        (v) => {
          battPower = v
        },
        data.batteryPowerKw,
        0.01,
      )
      animateTo(
        'soc',
        () => soc,
        (v) => {
          soc = v
        },
        data.batterySoc,
        1,
      )
      animateTo(
        'grid',
        () => grid,
        (v) => {
          grid = v
        },
        data.gridPowerKw,
        0.01,
      )
    })

    let resizeTimer: ReturnType<typeof setTimeout>
    const ro = new ResizeObserver(([e]) => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        svgW = Math.round(e.contentRect.width)
      }, 150)
    })
    if (containerEl) ro.observe(containerEl)

    return () => {
      ro.disconnect()
      clearTimeout(resizeTimer)
      socket.disconnect()
      Object.values(timers).forEach(clearInterval)
    }
  })
</script>

<!--
  Fan layout (viewBox 0 0 360 380) — Home is the hub everything flows into:
        Solar (top)
            |
         Home (center)
          /      \
   Battery      Grid
   (bot-left)   (bot-right)

  Flow rules (per owner's system):
    solar→home    always when pv > 0
    home→battery  when charging (solar surplus routes through home into battery)
    battery→home  when discharging (solar alone insufficient, battery tops up)
    grid→home     when grid < 0 (grid buys in; no reverse — house never exports)
-->

{#snippet dots(pathId: string, color: string, r: number, kw: number)}
  {#each [0, 1, 2] as i (i)}
    <circle {r} fill={color}>
      <animateMotion dur={dur(kw)} begin={begin(kw, i)} repeatCount="indefinite" calcMode="linear">
        <mpath href={`#${pathId}`} />
      </animateMotion>
      <animate attributeName="opacity" dur={dur(kw)} begin={begin(kw, i)} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.15;0.85;1" />
    </circle>
  {/each}
{/snippet}

<section class="flex h-full flex-col rounded-lg border border-border/70 bg-card p-6 md:p-8">
  <div class="mb-2 flex items-center justify-between">
    <h2 class="font-serif text-xl font-light">การไหลของพลังงาน</h2>
    {#if connected}
      <span class="flex items-center gap-2 text-[10px] uppercase tracking-luxury text-muted-foreground">
        <span class="size-1.5 animate-pulse rounded-full bg-chart-1"></span>เรียลไทม์
      </span>
    {:else}
      <span class="flex items-center gap-2 text-[10px] uppercase tracking-luxury text-muted-foreground/50">
        <span class="size-1.5 rounded-full bg-muted-foreground/40"></span>offline
      </span>
    {/if}
  </div>

  <div bind:this={containerEl} class="mx-auto w-full max-w-90">
    <svg bind:this={svgEl} viewBox="0 0 360 380" width={svgW || undefined} height={svgH || undefined} class="h-auto w-full" role="img" aria-label="แผนผังการไหลของพลังงาน">
      <defs>
        <path id="p-sh" d="M180,66 L180,130" />
        <path id="p-hb" d="M162,180 L98,256" />
        <path id="p-bh" d="M98,256 L162,180" />
        <path id="p-gh" d="M262,256 L198,180" />
      </defs>

      <!-- dormant conduit + thin connector -->
      {#each ['p-sh', 'p-hb', 'p-gh'] as id (id)}
        <use href={`#${id}`} fill="none" stroke="var(--border)" stroke-width="3.5" stroke-opacity="0.07" />
        <use href={`#${id}`} fill="none" stroke="var(--border)" stroke-width="1" stroke-opacity="0.45" />
      {/each}

      <!-- flows -->
      {#if producing}{@render dots('p-sh', 'var(--chart-2)', 3, pv)}{/if}
      {#if charging}
        <use href="#p-hb" fill="none" stroke="var(--chart-1)" stroke-width="1.5" stroke-opacity="0.5" />
        {@render dots('p-hb', 'var(--chart-1)', 3, battPower)}
      {/if}
      {#if discharging}{@render dots('p-bh', 'var(--chart-1)', 2.5, battPower)}{/if}
      {#if importing}{@render dots('p-gh', 'var(--chart-4)', 2.5, grid)}{/if}

      <!-- solar node (top) -->
      <foreignObject x="120" y="10" width="120" height="110">
        <div class="flex flex-col items-center text-center">
          <div
            class="flex size-14 items-center justify-center rounded-full border transition-colors {producing
              ? 'border-chart-2/40 bg-chart-2/10 text-chart-2'
              : 'border-border bg-card text-muted-foreground'}"
          >
            <Sun size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <p class="mt-2 text-[10px] uppercase tracking-luxury text-muted-foreground">แผงโซลาร์</p>
          <p class="mt-1 font-serif text-base font-light leading-none">{num(pv, 2)} kW</p>
        </div>
      </foreignObject>

      <!-- home node (center hub) -->
      <foreignObject x="120" y="130" width="120" height="110">
        <div class="flex flex-col items-center text-center">
          <div class="flex size-14 items-center justify-center rounded-full border border-foreground/30 bg-foreground text-primary-foreground">
            <House size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <p class="mt-2 text-[10px] uppercase tracking-luxury text-muted-foreground">โหลดในบ้าน</p>
          <p class="mt-1 font-serif text-base font-light leading-none">{num(load, 2)} kW</p>
        </div>
      </foreignObject>

      <!-- battery node (bottom-left) -->
      <foreignObject x="20" y="250" width="120" height="120">
        <div class="flex flex-col items-center text-center">
          <div
            class="flex size-14 items-center justify-center rounded-full border transition-colors {charging
              ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
              : discharging
                ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                : 'border-border bg-card text-muted-foreground'}"
          >
            {#if charging}
              <BatteryCharging size={20} strokeWidth={1.5} aria-hidden="true" />
            {:else}
              <Battery size={20} strokeWidth={1.5} aria-hidden="true" />
            {/if}
          </div>
          <p class="mt-2 text-[10px] uppercase tracking-luxury text-muted-foreground">แบตเตอรี่</p>
          <p class="mt-1 font-serif text-base font-light leading-none">{soc}%</p>
          <p class="mt-1 text-[10px] text-muted-foreground">{charging ? 'กำลังชาร์จ' : discharging ? 'จ่ายไฟ' : 'คงที่'}</p>
        </div>
      </foreignObject>

      <!-- grid node (bottom-right) -->
      <foreignObject x="220" y="250" width="120" height="120">
        <div class="flex flex-col items-center text-center">
          <div
            class="flex size-14 items-center justify-center rounded-full border transition-colors {importing
              ? 'border-chart-4/40 bg-chart-4/10 text-chart-4'
              : 'border-border bg-card text-muted-foreground'}"
          >
            <Zap size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <p class="mt-2 text-[10px] uppercase tracking-luxury text-muted-foreground">การไฟฟ้า</p>
          <p class="mt-1 font-serif text-base font-light leading-none">{num(grid, 2)} kW</p>
          <p class="mt-1 text-[10px] text-muted-foreground">{importing ? 'นำเข้าจากกริด' : 'ไม่ได้ซื้อไฟ'}</p>
        </div>
      </foreignObject>
    </svg>
  </div>

  <p class="mt-auto border-t border-border/60 pt-4 text-sm leading-relaxed text-muted-foreground">
    แผงผลิตได้ <strong class="font-medium text-foreground">{num(pv, 2)} kW</strong>
    · บ้านใช้ <strong class="font-medium text-foreground">{num(load, 2)} kW</strong>
    {#if charging}
      · โซลาร์เหลือ ชาร์จเข้าแบต <strong class="font-medium text-foreground">{num(Math.abs(battPower), 2)} kW</strong>
    {:else if discharging}
      · แบตจ่ายเสริม <strong class="font-medium text-foreground">{num(battPower, 2)} kW</strong>
    {/if}
    {#if importing}
      · ซื้อไฟ <strong class="font-medium text-foreground">{num(Math.abs(grid), 2)} kW</strong>
    {:else}
      · <strong class="font-medium text-foreground">ไม่ได้ซื้อไฟจากการไฟฟ้าเลย</strong>
    {/if}
  </p>
</section>
