<script lang="ts">
  import { onMount } from 'svelte'
  import { getConnectivity, startConnectivity, subscribeConnectivity, type ConnectivitySnapshot } from '@/lib/connectivity'
  import { formatOutageDuration } from '@/lib/offline-log'
  import { num } from '@/lib/electricity'
  import Wifi from '@lucide/svelte/icons/wifi'
  import WifiOff from '@lucide/svelte/icons/wifi-off'

  /**
   * การ์ด "สถานะอินเทอร์เน็ต" — ต้องเป็น island เพราะค่าที่ server ส่งมาตอน render
   * จะค้างอยู่ตรงนั้นตลอดถ้าเน็ตล่ม (server ส่งค่าใหม่มาไม่ได้) เบราว์เซอร์เท่านั้น
   * ที่รู้ว่า "ตอนนี้ก็ยังหลุดอยู่" — เวลาหลุดที่เครื่องนี้จับได้จึงถูกบวกเข้ายอดของวัน
   */
  let {
    serverOnline,
    downSecToday,
  }: {
    /** สถานะจาก collector ตอน render หน้า */
    serverOnline: boolean
    /** วินาทีที่ collector บันทึกว่าเน็ตหลุดวันนี้ */
    downSecToday: number
  } = $props()

  let state = $state<ConnectivitySnapshot>(getConnectivity())

  const offline = $derived(state.settled && !state.online)
  const online = $derived(!offline && serverOnline)
  // ยอดของ collector + ยอดที่เครื่องนี้จับได้เอง — ช่วงที่ server ล่มมีแต่ฝั่งนี้ที่นับได้
  const totalDownSec = $derived(downSecToday + state.outageSecToday)
  const uptimePct = $derived(Math.max(0, 100 - (totalDownSec / 86400) * 100))

  onMount(() => {
    startConnectivity()
    return subscribeConnectivity((next) => {
      state = next
    })
  })
</script>

<div class:list={['flex flex-col gap-5 rounded-lg border bg-card p-5', online ? 'border-border/70' : 'border-destructive/40']}>
  <div class="flex items-center justify-between">
    <span class={online ? 'text-chart-1' : 'text-destructive'}>
      {#if online}
        <Wifi size={18} strokeWidth={1.25} />
      {:else}
        <WifiOff size={18} strokeWidth={1.25} />
      {/if}
    </span>
    <span class:list={['rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider', offline ? 'border-destructive/40 text-destructive' : 'border-border/70 text-muted-foreground']}>
      {offline ? 'หลุดอยู่ตอนนี้' : `ใช้งานได้ ${num(uptimePct, 2)}%`}
    </span>
  </div>
  <div class="space-y-1.5">
    <p class="text-[10px] uppercase tracking-luxury text-muted-foreground">สถานะอินเทอร์เน็ต</p>
    <p class="font-serif text-3xl font-light leading-none text-foreground">{online ? 'ใช้งานได้' : 'ขัดข้อง'}</p>
    <p class="text-xs leading-relaxed text-muted-foreground">
      {#if offline}
        หลุดมาแล้ว {formatOutageDuration(state.outageSec)} · วันนี้รวม {formatOutageDuration(totalDownSec)}
      {:else if totalDownSec > 0}
        วันนี้เน็ตหลุดรวม {formatOutageDuration(totalDownSec)}
      {:else}
        วันนี้ยังไม่มีช่วงที่เน็ตหลุด
      {/if}
    </p>
  </div>
</div>
