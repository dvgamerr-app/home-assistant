<script lang="ts">
  import { onMount } from 'svelte'
  import { applyServiceWorkerUpdate, getConnectivity, requestConnectivityProbe, startConnectivity, subscribeConnectivity, type ConnectivitySnapshot } from '@/lib/connectivity'
  import { formatOutageDuration } from '@/lib/offline-log'
  import { formatBangkokTime } from '@/lib/date'
  import CloudOff from '@lucide/svelte/icons/cloud-off'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Check from '@lucide/svelte/icons/check'
  import ArrowUpCircle from '@lucide/svelte/icons/arrow-up-circle'

  /**
   * แถบสถานะออฟไลน์ — เกาะอยู่ใน Layout ทุกหน้า และเป็นตัวที่ "ติดเครื่อง" ให้ทั้งระบบ:
   * เรียก startConnectivity() ซึ่งลงทะเบียน service worker และเริ่ม probe ให้เกาะอื่น
   * (กราฟ/EnergyFlow) มาใช้สถานะเดียวกันได้
   */
  const RECONNECTED_NOTICE_MS = 6000

  let state = $state<ConnectivitySnapshot>(getConnectivity())
  let showReconnected = $state(false)
  let previousOnline = true

  const offline = $derived(state.settled && !state.online)
  const cachedLabel = $derived(state.cachedAt === null ? null : formatBangkokTime(state.cachedAt))

  onMount(() => {
    startConnectivity()
    let timer: ReturnType<typeof setTimeout> | undefined

    const unsubscribe = subscribeConnectivity((next) => {
      if (next.settled && next.online && !previousOnline) {
        showReconnected = true
        clearTimeout(timer)
        timer = setTimeout(() => {
          showReconnected = false
        }, RECONNECTED_NOTICE_MS)
      }
      if (next.settled) previousOnline = next.online
      state = next
    })

    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  })
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-4" aria-live="polite">
  {#if state.updateReady}
    <div class="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-lg border border-accent/50 bg-card px-4 py-3 shadow-none">
      <ArrowUpCircle class="shrink-0 text-accent-foreground" size={16} strokeWidth={1.5} />
      <p class="min-w-0 flex-1 text-sm text-foreground">มีเวอร์ชันใหม่ของแดชบอร์ดพร้อมใช้งาน</p>
      <button
        type="button"
        onclick={applyServiceWorkerUpdate}
        class="shrink-0 rounded-full border border-border/70 px-3 py-1 text-[10px] uppercase tracking-luxury text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        อัปเดต
      </button>
    </div>
  {/if}

  {#if offline}
    <div class="pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-lg border border-destructive/40 bg-card px-4 py-3">
      <CloudOff class="mt-0.5 shrink-0 text-destructive" size={16} strokeWidth={1.5} />
      <div class="min-w-0 flex-1">
        <p class="text-sm text-foreground">
          ออฟไลน์ — เชื่อมต่อกับบ้านไม่ได้
          {#if state.outageSec >= 60}<span class="text-muted-foreground">· {formatOutageDuration(state.outageSec)}</span>{/if}
        </p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
          {#if cachedLabel}
            กำลังแสดงข้อมูลที่บันทึกไว้เมื่อ {cachedLabel} น. · หยุดอัปเดตเรียลไทม์ไว้ก่อน
          {:else}
            กำลังแสดงข้อมูลที่บันทึกไว้ในเครื่อง · หยุดอัปเดตเรียลไทม์ไว้ก่อน
          {/if}
        </p>
      </div>
      <button
        type="button"
        onclick={requestConnectivityProbe}
        class="shrink-0 rounded-full border border-border/70 px-3 py-1 text-[10px] uppercase tracking-luxury text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        ลองใหม่
      </button>
    </div>
  {:else if showReconnected}
    <div class="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-lg border border-chart-1/40 bg-card px-4 py-3">
      <Check class="shrink-0 text-chart-1" size={16} strokeWidth={1.5} />
      <p class="min-w-0 flex-1 text-sm text-foreground">กลับมาออนไลน์แล้ว · เริ่มอัปเดตเรียลไทม์ต่อ</p>
      <button
        type="button"
        onclick={() => location.reload()}
        class="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-3 py-1 text-[10px] uppercase tracking-luxury text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <RefreshCw size={12} strokeWidth={1.5} />
        โหลดใหม่
      </button>
    </div>
  {/if}
</div>
