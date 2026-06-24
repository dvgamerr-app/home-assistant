<script lang="ts">
  import { onMount } from 'svelte'
  import { io } from 'socket.io-client'
  import { num } from '@/lib/electricity'
  import BatteryCharging from '@lucide/svelte/icons/battery-charging'
  import BatteryFull from '@lucide/svelte/icons/battery-full'
  import Clock from '@lucide/svelte/icons/clock'
  import Heart from '@lucide/svelte/icons/heart'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Activity from '@lucide/svelte/icons/activity'
  import Gauge from '@lucide/svelte/icons/gauge'
  import Plug from '@lucide/svelte/icons/plug'
  import Timer from '@lucide/svelte/icons/timer'
  import SunMedium from '@lucide/svelte/icons/sun-medium'
  import type { SolarData } from '@/lib/solar-data'
  import type { LiveSnapshot } from '@/lib/db'

  let { live: init, pvStrings, system, socketUrl }: { live: LiveSnapshot; pvStrings: SolarData['pvStrings']; system: SolarData['system']; socketUrl: string } = $props()

  let live = $state(init)

  // Battery derived
  const battStatus = $derived(live.batteryPowerKw < -0.05 ? 'charging' : live.batteryPowerKw > 0.05 ? 'discharging' : 'idle')
  const battStatusLabel = $derived(({ charging: 'กำลังชาร์จ', discharging: 'กำลังจ่ายไฟ', idle: 'พร้อมใช้งาน' } as const)[battStatus])
  const storedKwh = $derived((system.batteryCapacityKwh * live.batterySoc) / 100)
  const backupHours = $derived(live.loadPowerKw > 0 ? storedKwh / live.loadPowerKw : 0)

  // System health derived
  const ratedKw = $derived(live.powerRating || system.ratedPowerKw)
  const loadFactorPct = $derived(ratedKw > 0 ? (live.pvPowerKw / ratedKw) * 100 : 0)
  const gridVoltageOk = $derived(live.gridVoltage >= 210 && live.gridVoltage <= 245)

  // PV strings derived
  const perStringMax = system.ratedPowerKw / pvStrings.length
  const totalPower = $derived(live.pv1.power + live.pv2.power)

  onMount(() => {
    const socket = io(socketUrl, { transports: ['websocket'] })
    socket.on('live', (d) => {
      live = d
    })
    return () => socket.disconnect()
  })

  function pvLive(i: number) {
    return i === 0 ? live.pv1 : live.pv2
  }
</script>

<div class="grid gap-6 lg:grid-cols-3">
  <!-- ── Battery Card ── -->
  <section class="rounded-lg border border-border/70 bg-card p-6">
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-2 text-muted-foreground">
        {#if battStatus === 'charging'}
          <BatteryCharging size={18} strokeWidth={1.25} />
        {:else}
          <BatteryFull size={18} strokeWidth={1.25} />
        {/if}
        <h2 class="font-serif text-lg font-light text-foreground">แบตเตอรี่ &amp; ไฟสำรอง</h2>
      </div>
      <span class="rounded-full border border-border/70 px-3 py-1 text-[10px] uppercase tracking-luxury text-muted-foreground">{battStatusLabel}</span>
    </div>

    <div class="mb-2 flex items-end justify-between">
      <span class="text-[10px] uppercase tracking-luxury text-muted-foreground">ระดับพลังงานคงเหลือ</span>
      <span class="font-serif text-3xl font-light text-foreground">{live.batterySoc}<span class="text-lg text-muted-foreground">%</span></span>
    </div>
    <div class="h-px w-full bg-border">
      <div class="h-px" style:width="{live.batterySoc}%" style:background="var(--chart-3)"></div>
    </div>
    <p class="mt-3 text-sm text-muted-foreground">
      เก็บไฟไว้ {num(storedKwh, 1)} kWh{battStatus === 'charging' ? ' · กำลังเติมเข้าแบตเตอรี่' : ''}
    </p>

    <div class="mt-6 grid grid-cols-3 gap-3">
      <div class="rounded-md border border-border/60 p-3">
        <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Clock size={14} strokeWidth={1.25} />
          <span class="text-[10px] uppercase tracking-wider">สำรองได้อีก</span>
        </div>
        <p class="font-mono text-lg font-medium leading-none text-foreground">
          {num(backupHours, 1)}<span class="ml-1 text-sm font-normal">ชม.</span>
        </p>
        <p class="mt-1.5 text-[11px] text-muted-foreground">ถ้าไฟดับ</p>
      </div>
      <div class="rounded-md border border-border/60 p-3">
        <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Heart size={14} strokeWidth={1.25} />
          <span class="text-[10px] uppercase tracking-wider">สุขภาพแบต</span>
        </div>
        <p class="font-mono text-lg font-medium leading-none text-foreground">
          {live.batterySoh}<span class="ml-1 text-sm font-normal">%</span>
        </p>
        <p class="mt-1.5 text-[11px] text-muted-foreground">SOH</p>
      </div>
      <div class="rounded-md border border-border/60 p-3">
        <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <RefreshCw size={14} strokeWidth={1.25} />
          <span class="text-[10px] uppercase tracking-wider">รอบชาร์จ</span>
        </div>
        <p class="font-mono text-lg font-medium leading-none text-foreground">{live.cyclePeriod}</p>
        <p class="mt-1.5 text-[11px] text-muted-foreground">cycles</p>
      </div>
    </div>
  </section>

  <!-- ── System Health ── -->
  <section class="rounded-lg border border-border/70 bg-card p-6">
    <div class="mb-6 flex items-center gap-2 text-muted-foreground">
      <Activity size={18} strokeWidth={1.25} />
      <h2 class="font-serif text-lg font-light text-foreground">สุขภาพระบบ / อินเวอร์เตอร์</h2>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-md border border-border/60 p-3">
        <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Gauge size={14} strokeWidth={1.25} />
          <span class="text-[10px] uppercase tracking-wider">กำลังทำงาน</span>
        </div>
        <p class="font-mono text-lg font-medium leading-none text-foreground">{num(loadFactorPct, 0)}%</p>
        <p class="mt-1.5 text-[11px] text-chart-1">จาก {num(ratedKw, 0)} kW</p>
      </div>
      <div class="rounded-md border border-border/60 p-3">
        <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Plug size={14} strokeWidth={1.25} />
          <span class="text-[10px] uppercase tracking-wider">แรงดันไฟ</span>
        </div>
        <p class="font-mono text-lg font-medium leading-none text-foreground">{num(live.gridVoltage, 0)} V</p>
        <p class:list={['mt-1.5 text-[11px]', gridVoltageOk ? 'text-chart-1' : 'text-destructive']}>
          {gridVoltageOk ? 'ปกติ' : 'ผิดปกติ'}
        </p>
      </div>
      <div class="rounded-md border border-border/60 p-3">
        <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Activity size={14} strokeWidth={1.25} />
          <span class="text-[10px] uppercase tracking-wider">ความถี่</span>
        </div>
        <p class="font-mono text-lg font-medium leading-none text-foreground">50.00 Hz</p>
        <p class="mt-1.5 text-[11px] text-chart-1">ปกติ</p>
      </div>
      <div class="rounded-md border border-border/60 p-3">
        <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Timer size={14} strokeWidth={1.25} />
          <span class="text-[10px] uppercase tracking-wider">ชั่วโมงทำงานรวม</span>
        </div>
        <p class="font-mono text-lg font-medium leading-none text-foreground">{num(live.totalGenerationTime, 0)}</p>
        <p class="mt-1.5 text-[11px] text-muted-foreground">ชั่วโมง</p>
      </div>
    </div>
  </section>

  <!-- ── Panel Strings ── -->
  <section class="rounded-lg border border-border/70 bg-card p-6">
    <div class="mb-6 flex items-center gap-2 text-muted-foreground">
      <SunMedium size={18} strokeWidth={1.25} />
      <h2 class="font-serif text-lg font-light text-foreground">แผงโซลาร์ (รายชุด)</h2>
    </div>

    <div class="space-y-5">
      {#each pvStrings as pv, i (pv.name)}
        {@const lp = pvLive(i)}
        {@const maxRef = pv.peakKw && pv.peakKw > 0 ? pv.peakKw : perStringMax}
        {@const pct = Math.min(100, (lp.power / maxRef) * 100)}
        {@const active = lp.power > 0.05}
        {@const statusLabel = active ? `${num(lp.voltage, 0)} V · ${num(lp.current, 1)} A · ${num(pv.peakKw ?? 0, 2)} kW` : pv.installed ? `ไม่ผลิต · ${num(pv.peakKw ?? 0, 2)} kW` : 'ไม่ได้ติดตั้ง'}
        <div>
          <div class="mb-1.5 flex items-center justify-between">
            <span class="text-sm text-foreground">{pv.name}</span>
            <span class="font-mono text-sm text-foreground">{num(lp.power, 2)} kW</span>
          </div>
          <div class="h-0.5 w-full bg-border">
            <div class="h-0.5 bg-chart-2" style:width="{pct}%"></div>
          </div>
          <div class="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{statusLabel}</span>
            <span>{num(pct, 0)}% ของกำลังสูงสุด</span>
          </div>
        </div>
      {/each}
    </div>

    <p class="mt-6 border-t border-border/60 pt-4 text-sm text-muted-foreground">
      กำลังผลิตรวมขณะนี้ <span class="font-mono font-medium text-foreground">{num(totalPower, 2)} kW</span>
    </p>
  </section>
</div>
