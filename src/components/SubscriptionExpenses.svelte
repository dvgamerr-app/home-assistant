<script lang="ts">
  import { expenseTiles } from '@/lib/subscription-treemap'
  import SubscriptionWebsiteIcon from './SubscriptionWebsiteIcon.svelte'
  import Zap from '@lucide/svelte/icons/zap'
  import Droplets from '@lucide/svelte/icons/droplets'
  import { money, monthlyBahtTotal, monthlyBahtMinor, toBahtMinor, type Subscription, type SubscriptionAccount, type SubscriptionExchangeRate, type UtilityExpense } from '@/lib/subscriptions'

  let {
    subscriptions,
    accounts,
    rate,
    utilities,
    onedit,
    disabled = false,
  }: {
    subscriptions: Subscription[]
    accounts: SubscriptionAccount[]
    rate: SubscriptionExchangeRate | null
    utilities: UtilityExpense[]
    onedit: (item: Subscription) => void
    disabled?: boolean
  } = $props()

  const active = $derived(subscriptions.filter((item) => item.status === 'active'))
  const subscriptionTotal = $derived(monthlyBahtTotal(active, rate))
  const annualSubscriptionTotal = $derived(monthlyBahtTotal(active, rate, true))
  const utilityMonthly = $derived(utilities.reduce((sum, item) => sum + item.amountMinor, 0))
  const totalMinor = $derived(subscriptionTotal.amountMinor === null ? null : subscriptionTotal.amountMinor + utilityMonthly)
  const annualMinor = $derived(annualSubscriptionTotal.amountMinor === null ? null : annualSubscriptionTotal.amountMinor + utilityMonthly * 12)
  const tiles = $derived(
    expenseTiles([
      ...active.map((item) => ({ id: `sub:${item.id}`, amountMinor: monthlyBahtMinor(item, rate) ?? 0 })),
      ...utilities.map((item) => ({ id: `util:${item.key}`, amountMinor: item.amountMinor })),
    ]),
  )
  const color = (name: string) => `var(--chart-${([...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5) + 1})`
  const utilityColor = { electricity: 'var(--chart-2)', water: 'var(--chart-1)' } as const
</script>

<section class="rounded-xl border border-border/70 bg-card p-4 sm:p-6" aria-label="สัดส่วนค่าใช้จ่ายรายเดือน">
  <header class="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="text-[10px] uppercase tracking-luxury text-muted-foreground">SPENDING OVERVIEW</p>
      <h2 class="mt-1 font-serif text-2xl font-light">ค่าใช้จ่ายของบ้าน ไปกับอะไรบ้าง</h2>
    </div>
    <p class="text-xs text-muted-foreground">ยอดเฉลี่ยต่อเดือนเป็นเงินบาท · ค่าไฟ/ค่าน้ำเฉลี่ยจากบิลล่าสุด · ค่า internet เพิ่มเป็นบริการเพื่อนับรวม</p>
  </header>
  {#if subscriptionTotal.unconvertedCount}
    <p class="rounded-lg bg-secondary/50 px-5 py-12 text-center text-sm text-muted-foreground">ยังแสดงสัดส่วนรวมไม่ได้ กำลังรออัตราแลกเปลี่ยนของ {subscriptionTotal.unconvertedCount} รายการ</p>
  {:else if tiles.length}
    <div class="expense-map">
      {#each tiles as tile (tile.id)}
        {@const util = utilities.find((u) => `util:${u.key}` === tile.id)}
        {@const item = util ? undefined : active.find((s) => `sub:${s.id}` === tile.id)}
        {@const small = tile.width < 22 || tile.height < 34}
        {@const share = totalMinor ? (tile.amountMinor / totalMinor) * 100 : 0}
        {@const name = util ? util.label : (item?.service ?? '')}
        {@const sub = util ? `เฉลี่ยจาก ${util.months} บิลล่าสุด` : (accounts.find((a) => a.id === item?.accountId)?.name ?? '')}
        {@const tone = util ? utilityColor[util.key] : color(name)}
        {@const yearly = util ? util.amountMinor * 12 : (toBahtMinor(item?.amountMinor ?? 0, item?.currency ?? 'THB', rate) ?? 0) * (item?.billingInterval === 'yearly' ? 1 : 12)}
        <div class="expense-cell" style={`left:${tile.x}%;top:${tile.y}%;width:${tile.width}%;height:${tile.height}%`}>
          <svelte:element
            this={util ? 'a' : 'button'}
            class="expense-tile"
            class:compact={small}
            style={`--tile-color: ${tone}`}
            href={util?.href}
            disabled={util ? undefined : disabled}
            onclick={util || !item ? undefined : () => onedit(item)}
            aria-label={`${name} · ${sub} · ${money(tile.amountMinor, 'THB')} ต่อเดือน · ${share.toFixed(1)}%`}
            title={`${name} · ${money(tile.amountMinor, 'THB')} / เดือน`}
          >
            <span class="flex items-start justify-between gap-2">
              <span class="service-mark">
                {#if util?.key === 'electricity'}<Zap size={16} />{:else if util}<Droplets size={16} />{:else if item}<SubscriptionWebsiteIcon website={item.url} {name} />{/if}
              </span>
              <span class="share">{share < 1 ? '<1' : Math.round(share)}%</span>
            </span>
            <span class="details min-w-0">
              <span class="block truncate text-sm font-medium">{name}</span>
              <span class="account-name mt-1 block truncate text-[11px] text-muted-foreground">{sub}</span>
              <span class="tile-price mt-1 block truncate font-serif text-2xl font-light">{money(tile.amountMinor, 'THB')}</span>
              <span class="annual mt-1 block text-xs text-muted-foreground">≈ {money(yearly, 'THB')} / ปี</span>
            </span>
          </svelte:element>
        </div>
      {/each}
    </div>
  {:else}
    <div class="rounded-lg border border-dashed border-border bg-secondary/20 px-5 py-12 text-center text-sm text-muted-foreground">
      {active.length ? 'บริการที่ใช้งานอยู่ไม่มีค่าใช้จ่ายรายเดือน' : 'เพิ่มบริการแล้วดูสัดส่วนค่าใช้จ่ายของบ้านได้ที่นี่'}
    </div>
  {/if}
  <footer class="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border/60 bg-secondary/20 px-5 py-4">
    <div>
      <p class="text-[10px] uppercase tracking-luxury text-muted-foreground">รวมต่อเดือน</p>
      <p class="mt-1 font-serif text-3xl font-light">{totalMinor === null ? 'รอเรท' : money(totalMinor, 'THB')}</p>
    </div>
    <div class="text-right">
      <p class="text-[10px] uppercase tracking-luxury text-muted-foreground">ประมาณการต่อปี</p>
      <p class="mt-1 font-serif text-2xl font-light text-foreground">{annualMinor === null ? 'รอเรท' : money(annualMinor, 'THB')}</p>
    </div>
  </footer>
</section>

<style>
  .expense-map {
    position: relative;
    height: 360px;
    isolation: isolate;
  }
  .expense-cell {
    position: absolute;
    padding: 4px;
  }
  .expense-tile {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.5rem;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 1.25rem;
    min-width: 0;
    text-align: left;
    color: var(--foreground);
    cursor: pointer;
    border-radius: 1rem;
    overflow: hidden;
    background: color-mix(in oklch, var(--tile-color) 24%, var(--card));
  }
  .expense-tile:hover:not(:disabled) {
    background: color-mix(in oklch, var(--tile-color) 32%, var(--card));
  }
  .expense-tile:focus-visible {
    outline: 2px solid var(--foreground);
    outline-offset: -5px;
  }
  .expense-tile:disabled {
    cursor: default;
  }
  .service-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--card);
    font-size: 16px;
  }
  .share {
    border-radius: 999px;
    padding: 0.25rem 0.5rem;
    background: color-mix(in oklch, var(--card) 75%, transparent);
    font-size: 10px;
  }
  .compact {
    padding: 0.875rem;
  }
  .compact {
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
  }
  .compact > span:first-child {
    display: contents;
  }
  .compact .service-mark {
    order: 1;
  }
  .compact .details {
    order: 2;
    flex: 1;
  }
  .compact .share {
    order: 3;
  }
  .compact .annual,
  .compact .account-name {
    display: none;
  }
  .compact .tile-price {
    margin-top: 0;
    font-size: 1rem;
  }
  @media (max-width: 639px) {
    .expense-map {
      height: 320px;
    }
    .expense-tile {
      padding: 0.875rem;
    }
    .tile-price {
      font-size: 1.125rem;
    }
    .annual {
      display: none;
    }
  }
</style>
