<script lang="ts">
  import { untrack } from 'svelte'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'

  let { selected }: { selected: string } = $props()

  const MONTH_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
  const DOW_TH = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

  const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const shift = (iso: string, days: number) => {
    const [y, m, d] = iso.split('-').map(Number)
    return toISO(new Date(y, m - 1, d + days))
  }
  const today = toISO(new Date())
  const yesterday = shift(today, -1)

  function displayDate(iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    return `${d} ${MONTH_TH[m - 1]} ${y + 543}`
  }

  const [selY, selM] = untrack(() => selected.split('-').map(Number))
  let open = $state(false)
  let viewYear = $state(selY)
  let viewMonth = $state(selM - 1)

  const calDays = $derived(
    (() => {
      const first = new Date(viewYear, viewMonth, 1)
      const last = new Date(viewYear, viewMonth + 1, 0)
      const startDow = (first.getDay() + 6) % 7
      const cells: (number | null)[] = Array(startDow).fill(null)
      for (let d = 1; d <= last.getDate(); d++) cells.push(d)
      return cells
    })(),
  )

  const viewLabel = $derived(`${MONTH_TH[viewMonth]} ${viewYear + 543}`)
  const canNextMonth = $derived(`${viewYear}-${String(viewMonth + 2).padStart(2, '0')}` <= today.slice(0, 7))

  function navigate(iso: string) {
    window.location.href = window.location.pathname + '?date=' + iso
  }

  function offset(days: number) {
    navigate(shift(selected, days))
  }

  function prevMonth() {
    if (viewMonth === 0) {
      viewYear--
      viewMonth = 11
    } else viewMonth--
  }

  function nextMonth() {
    if (!canNextMonth) return
    if (viewMonth === 11) {
      viewYear++
      viewMonth = 0
    } else viewMonth++
  }

  function cellISO(day: number) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  let rootEl: HTMLElement | undefined

  $effect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (rootEl && !rootEl.contains(e.target as Node)) open = false
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  })
</script>

<div class="relative flex flex-wrap items-center gap-1" bind:this={rootEl}>
  <button onclick={() => offset(-1)} class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="วันก่อน">
    <ChevronLeft size={14} />
  </button>

  <button onclick={() => (open = !open)} class="rounded px-2 py-1 font-serif font-light text-foreground hover:bg-muted">
    {displayDate(selected)}
  </button>

  {#if selected !== today}
    <button onclick={() => navigate(today)} class="rounded border border-border/70 px-2 py-1 text-[10px] uppercase tracking-luxury text-muted-foreground hover:bg-muted hover:text-foreground">
      วันนี้
    </button>
  {/if}

  {#if selected !== yesterday}
    <button onclick={() => navigate(yesterday)} class="rounded border border-border/70 px-2 py-1 text-[10px] uppercase tracking-luxury text-muted-foreground hover:bg-muted hover:text-foreground">
      เมื่อวาน
    </button>
  {/if}

  <button
    onclick={() => offset(1)}
    disabled={selected >= today}
    class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
    aria-label="วันถัดไป"
  >
    <ChevronRight size={14} />
  </button>

  {#if open}
    <div class="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-border/70 bg-card p-4 shadow-lg">
      <div class="mb-3 flex items-center justify-between">
        <button onclick={prevMonth} class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted">
          <ChevronLeft size={12} />
        </button>
        <span class="text-[11px] font-medium text-foreground">{viewLabel}</span>
        <button
          onclick={nextMonth}
          disabled={!canNextMonth}
          class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight size={12} />
        </button>
      </div>

      <div class="mb-1 grid grid-cols-7 gap-px">
        {#each DOW_TH as d (d)}
          <span class="py-0.5 text-center text-[9px] uppercase tracking-luxury text-muted-foreground">{d}</span>
        {/each}
      </div>

      <div class="grid grid-cols-7 gap-px">
        {#each calDays as day, ci (ci)}
          {#if day === null}
            <span></span>
          {:else}
            {@const iso = cellISO(day)}
            {@const isSel = iso === selected}
            {@const isToday = iso === today}
            {@const disabled = iso > today}
            <button
              onclick={() => {
                if (!disabled) {
                  navigate(iso)
                  open = false
                }
              }}
              {disabled}
              class="flex h-7 w-full items-center justify-center rounded-full text-[11px] leading-none
                {isSel ? 'bg-foreground text-background' : disabled ? 'cursor-not-allowed opacity-25 text-foreground' : 'text-foreground hover:bg-muted'}"
              style={isToday && !isSel ? 'color:var(--chart-2)' : ''}
            >
              {day}
            </button>
          {/if}
        {/each}
      </div>

      {#if selected !== today}
        <div class="mt-3 border-t border-border/60 pt-3">
          <button
            onclick={() => {
              navigate(today)
              open = false
            }}
            class="w-full rounded border border-border/70 py-1.5 text-[10px] uppercase tracking-luxury text-muted-foreground hover:bg-muted"
          >
            วันนี้
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
