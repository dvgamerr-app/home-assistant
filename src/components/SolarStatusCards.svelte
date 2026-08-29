<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { io } from 'socket.io-client'
  import { num } from '@/lib/electricity'
  import { getBatteryConnectionState } from '@/lib/battery'
  import BatteryCharging from '@lucide/svelte/icons/battery-charging'
  import BatteryFull from '@lucide/svelte/icons/battery-full'
  import BatteryWarning from '@lucide/svelte/icons/battery-warning'
  import Clock from '@lucide/svelte/icons/clock'
  import Heart from '@lucide/svelte/icons/heart'
  import Activity from '@lucide/svelte/icons/activity'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import Gauge from '@lucide/svelte/icons/gauge'
  import Plug from '@lucide/svelte/icons/plug'
  import Timer from '@lucide/svelte/icons/timer'
  import SunMedium from '@lucide/svelte/icons/sun-medium'
  import type { SolarData } from '@/lib/solar-data'
  import type { LiveSnapshot } from '@/lib/db'
  import { SOCKET_CHANNELS } from '@/lib/socket'

  let { live: init, pvStrings, system, socketUrl }: { live: LiveSnapshot; pvStrings: SolarData['pvStrings']; system: SolarData['system']; socketUrl: string } = $props()

  let live = $state(untrack(() => init))

  // Battery derived
  const batteryConnection = $derived(getBatteryConnectionState(live, system.batteryConnectedMinVoltage))
  const batteryConnected = $derived(batteryConnection === 'connected')
  const battStatus = $derived(
    batteryConnection === 'disconnected'
      ? 'disconnected'
      : batteryConnection === 'unknown'
        ? 'unknown'
        : live.batteryPowerKw < -0.05
          ? 'charging'
          : live.batteryPowerKw > 0.05
            ? 'discharging'
            : 'idle',
  )
  const battStatusLabel = $derived(({ charging: 'กำลังชาร์จ', discharging: 'กำลังจ่ายไฟ', idle: 'เชื่อมต่อ · รอทำงาน', disconnected: 'ไม่ได้เชื่อมต่อ', unknown: 'ไม่ทราบสถานะ' } as const)[battStatus])
  const storedKwh = $derived(batteryConnected ? (system.batteryCapacityKwh * live.batterySoc) / 100 : null)
  const remainingUsageHours = $derived(storedKwh !== null && live.loadPowerKw > 0 ? storedKwh / live.loadPowerKw : null)
  const batteryStateLabel = $derived(
    batteryConnection === 'disconnected'
      ? 'ไม่ได้เชื่อมต่อ'
      : batteryConnection === 'unknown'
        ? 'ไม่ทราบสถานะ'
        : live.batteryStatus === 'Idle'
          ? 'รอทำงาน'
          : live.batteryStatus === 'Charging'
            ? 'กำลังชาร์จ'
            : live.batteryStatus === 'Discharging'
              ? 'กำลังจ่ายไฟ'
              : (live.batteryStatus ?? '—'),
  )

  // System health derived
  const ratedKw = $derived(live.powerRating || system.ratedPowerKw)
  const loadFactorPct = $derived(ratedKw > 0 ? (live.pvPowerKw / ratedKw) * 100 : 0)
  const hasGridVoltage = $derived(live.gridVoltage > 0)
  const gridVoltageOk = $derived(hasGridVoltage && live.gridVoltage >= 210 && live.gridVoltage <= 245)
  const hasGridFrequency = $derived(live.gridFrequencyHz !== null)
  const gridFrequencyOk = $derived(live.gridFrequencyHz !== null && live.gridFrequencyHz >= 49.5 && live.gridFrequencyHz <= 50.5)
  const lastUpdateLabel = $derived(
    new Date(live.lastUpdate).getTime() > 0
      ? new Intl.DateTimeFormat('th-TH', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Bangkok',
        }).format(new Date(live.lastUpdate))
      : 'ยังไม่มีข้อมูล',
  )

  // PV strings derived
  const perStringMax = untrack(() => system.ratedPowerKw / pvStrings.length)
  const totalPower = $derived(live.pv1.power + live.pv2.power)

  onMount(() => {
    const socket = io(socketUrl, { transports: ['websocket'] })
    socket.on('connect', () => {
      socket.emit('subscribe', SOCKET_CHANNELS.live)
    })
    socket.on(SOCKET_CHANNELS.live, (d) => {
      live = d
    })
    return () => socket.disconnect()
  })

  function pvLive(i: number) {
    return i === 0 ? live.pv1 : live.pv2
  }

  function approximateHours(value: number | null) {
    return value !== null && value > 0 ? `~${Math.max(0, Math.round(value))} ชม.` : '—'
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-xs text-muted-foreground">
    <span class="flex items-center gap-2">
      <span class="size-1.5 rounded-full" class:bg-chart-1={live.isOnline} class:bg-destructive={!live.isOnline}></span>
      {live.isOnline ? 'ระบบออนไลน์' : 'ข้อมูลไม่เป็นปัจจุบัน'}
    </span>
    <span>ข้อมูลล่าสุด {lastUpdateLabel} น.</span>
  </div>

  {#if live.activeAlarms.length > 0}
    <section class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive">
      <div class="flex items-start gap-3">
        <CircleAlert class="mt-0.5 shrink-0" size={18} strokeWidth={1.25} />
        <div>
          <p class="font-medium">พบการแจ้งเตือนที่ยังไม่สิ้นสุด {live.activeAlarms.length} รายการ</p>
          {#each live.activeAlarms as alarm (alarm.key)}
            <p class="mt-1 text-sm text-foreground">{alarm.name ?? alarm.key}{alarm.description ? ` · ${alarm.description}` : ''}</p>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <div class="grid gap-6 lg:grid-cols-3">
    <!-- ── Battery Card ── -->
    <section class="rounded-lg border border-border/70 bg-card p-6">
      <div class="mb-6 flex items-center justify-between">
        <div class="flex items-center gap-2 text-muted-foreground">
          {#if battStatus === 'disconnected'}
            <BatteryWarning class="text-destructive" size={18} strokeWidth={1.25} />
          {:else if battStatus === 'charging'}
            <BatteryCharging size={18} strokeWidth={1.25} />
          {:else}
            <BatteryFull size={18} strokeWidth={1.25} />
          {/if}
          <h2 class="font-serif text-lg font-light text-foreground">แบตเตอรี่ &amp; พลังงานสะสม</h2>
        </div>
        <span
          class:list={[
            'rounded-full border px-3 py-1 text-[10px] uppercase tracking-luxury',
            battStatus === 'disconnected' ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-border/70 text-muted-foreground',
          ]}>{battStatusLabel}</span
        >
      </div>

      <div class="mb-2 flex items-end justify-between">
        <span class="text-[10px] uppercase tracking-luxury text-muted-foreground">ระดับพลังงานคงเหลือ</span>
        <span class="font-serif text-3xl font-light text-foreground">
          {#if batteryConnected}
            {live.batterySoc}<span class="text-lg text-muted-foreground">%</span>
          {:else}
            —
          {/if}
        </span>
      </div>
      <div class="h-px w-full bg-border">
        <div class="h-px" style:width="{batteryConnected ? Math.max(0, Math.min(100, live.batterySoc)) : 0}%" style:background="var(--chart-3)"></div>
      </div>
      <p class="mt-3 text-sm text-muted-foreground">
        {#if storedKwh !== null}
          เก็บไฟไว้ {num(storedKwh, 1)} kWh{battStatus === 'charging' ? ' · กำลังเติมเข้าแบตเตอรี่' : ''}
        {:else if batteryConnection === 'disconnected'}
          ค่า SOC/SOH จากอินเวอร์เตอร์อาจเป็นค่าค้าง จึงไม่นำมาคำนวณพลังงานสำรอง
        {:else}
          รอข้อมูลปัจจุบันจากอินเวอร์เตอร์
        {/if}
      </p>

      <div class="mt-6 grid grid-cols-3 gap-3">
        <div class="rounded-md border border-border/60 p-3">
          <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Clock size={14} strokeWidth={1.25} />
            <span class="text-[10px] uppercase tracking-wider">ใช้ต่อได้อีก</span>
          </div>
          <p class="font-mono text-lg font-medium leading-none text-foreground">{approximateHours(remainingUsageHours)}</p>
          <p class="mt-1.5 text-[11px] text-muted-foreground">{batteryConnected ? 'ประมาณจากโหลดขณะนี้' : 'ยังคำนวณไม่ได้'}</p>
        </div>
        <div class="rounded-md border border-border/60 p-3">
          <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Heart size={14} strokeWidth={1.25} />
            <span class="text-[10px] uppercase tracking-wider">สุขภาพแบต</span>
          </div>
          <p class="font-mono text-lg font-medium leading-none text-foreground">
            {batteryConnected ? (live.batterySoh ?? '—') : '—'}{#if batteryConnected && live.batterySoh !== null}<span class="ml-1 text-sm font-normal">%</span>{/if}
          </p>
          <p class="mt-1.5 text-[11px] text-muted-foreground">SOH</p>
        </div>
        <div class="rounded-md border border-border/60 p-3">
          <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Activity size={14} strokeWidth={1.25} />
            <span class="text-[10px] uppercase tracking-wider">สถานะแบต</span>
          </div>
          <p class="text-sm font-medium leading-none text-foreground">{batteryStateLabel}</p>
          <p class="mt-1.5 text-[11px] text-muted-foreground">
            {batteryConnection === 'disconnected' ? `แรงดัน ${num(live.batteryVoltage, 1)} V` : 'จากอินเวอร์เตอร์'}
          </p>
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
            <span class="text-[10px] uppercase tracking-wider">กำลังผลิตต่อพิกัด</span>
          </div>
          <p class="font-mono text-lg font-medium leading-none text-foreground">{num(loadFactorPct, 0)}%</p>
          <p class="mt-1.5 text-[11px] text-chart-1">จาก {num(ratedKw, 0)} kW</p>
        </div>
        <div class="rounded-md border border-border/60 p-3">
          <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Plug size={14} strokeWidth={1.25} />
            <span class="text-[10px] uppercase tracking-wider">แรงดันไฟ</span>
          </div>
          <p class="font-mono text-lg font-medium leading-none text-foreground">{hasGridVoltage ? `${num(live.gridVoltage, 1)} V` : '—'}</p>
          <p class:list={['mt-1.5 text-[11px]', !hasGridVoltage ? 'text-muted-foreground' : gridVoltageOk ? 'text-chart-1' : 'text-destructive']}>
            {!hasGridVoltage ? 'ไม่มีข้อมูล' : gridVoltageOk ? 'อยู่ในช่วงปกติ' : 'นอกช่วงปกติ'}
          </p>
        </div>
        <div class="rounded-md border border-border/60 p-3">
          <div class="mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Activity size={14} strokeWidth={1.25} />
            <span class="text-[10px] uppercase tracking-wider">ความถี่</span>
          </div>
          <p class="font-mono text-lg font-medium leading-none text-foreground">{hasGridFrequency ? `${num(live.gridFrequencyHz ?? 0, 2)} Hz` : '—'}</p>
          <p class:list={['mt-1.5 text-[11px]', !hasGridFrequency ? 'text-muted-foreground' : gridFrequencyOk ? 'text-chart-1' : 'text-destructive']}>
            {!hasGridFrequency ? 'ไม่มีข้อมูล' : gridFrequencyOk ? 'อยู่ในช่วงปกติ' : 'นอกช่วงปกติ'}
          </p>
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
      <p class="mt-5 border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
        เฟิร์มแวร์ {live.firmwareVersion ?? '—'} · S/N {live.serialNumber ?? system.serialNumber}
      </p>
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
          {@const statusLabel = active ? `${num(lp.voltage, 0)} V · ${num(lp.current, 1)} A` : pv.installed ? 'ยังไม่ผลิตในขณะนี้' : 'ไม่ได้ติดตั้ง'}
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
              <span>พีกที่บันทึก {num(pv.peakKw ?? 0, 2)} kW</span>
            </div>
          </div>
        {/each}
      </div>

      <p class="mt-6 border-t border-border/60 pt-4 text-sm text-muted-foreground">
        กำลังผลิตรวมขณะนี้ <span class="font-mono font-medium text-foreground">{num(totalPower, 2)} kW</span>
      </p>
    </section>
  </div>
</div>
