<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import Plus from '@lucide/svelte/icons/plus'
  import Pencil from '@lucide/svelte/icons/pencil'
  import X from '@lucide/svelte/icons/x'
  import CalendarDays from '@lucide/svelte/icons/calendar-days'
  import Users from '@lucide/svelte/icons/users'
  import CreditCard from '@lucide/svelte/icons/credit-card'
  import Search from '@lucide/svelte/icons/search'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { subscribeConnectivity } from '@/lib/connectivity'
  import SubscriptionExpenses from './SubscriptionExpenses.svelte'
  import SubscriptionWebsiteIcon from './SubscriptionWebsiteIcon.svelte'
  import { formatThaiDate, getBangkokISODate } from '@/lib/date'
  import {
    CURRENCIES,
    STATUS_LABELS,
    daysUntil,
    money,
    monthlyBahtTotal,
    toBahtMinor,
    subscriptionBillingDate,
    type Currency,
    type Subscription,
    type SubscriptionAccount,
    type SubscriptionSnapshot,
  } from '@/lib/subscriptions'

  let { initial, loadError = '' }: { initial: SubscriptionSnapshot; loadError?: string } = $props()
  let data = $state<SubscriptionSnapshot>(untrack(() => initial))
  let error = $state(untrack(() => loadError))
  let notice = $state('')
  let online = $state(true)
  let refreshing = $state(false)
  let saving = $state(false)
  let query = $state('')
  let accountFilter = $state('')
  let statusFilter = $state('active')
  let today = $state(getBangkokISODate())
  let dialog: HTMLDialogElement
  let kind = $state<'account' | 'subscription'>('subscription')
  let editing = $state<Subscription | SubscriptionAccount | null>(null)
  let formError = $state('')
  let defaultAccount = $state('')
  let dialogOpen = $state(false)

  let formAmount = $state<number | undefined>()
  let formCurrency = $state<Currency>('THB')
  let formService = $state('')
  let formWebsite = $state('')
  let iconWebsite = $state('')
  let formAccount = $state('')
  let formBillingDay = $state(1)
  let formBillingInterval = $state<Subscription['billingInterval']>('monthly')
  let formBillingDate = $state(getBangkokISODate())
  let formStatus = $state<Subscription['status']>('active')
  const totals = $derived(monthlyBahtTotal(data.subscriptions, data.exchangeRate))
  const annualTotals = $derived(monthlyBahtTotal(data.subscriptions, data.exchangeRate, true))
  const baht = (item: Subscription) => {
    const value = toBahtMinor(item.amountMinor, item.currency, data.exchangeRate)
    return value === null ? 'รอเรท USD/THB' : money(value, 'THB')
  }
  const formBaht = $derived(
    formAmount !== undefined && Number.isFinite(formAmount) && formAmount >= 0 && formAmount <= 1000000 ? toBahtMinor(Math.round(formAmount * 100), formCurrency, data.exchangeRate) : null,
  )
  const active = $derived(data.subscriptions.filter((s) => s.status === 'active'))
  const upcoming = $derived(active.map((s) => ({ ...s, due: subscriptionBillingDate(s, today) })).sort((a, b) => a.due.localeCompare(b.due) || a.service.localeCompare(b.service)))
  const dueSoon = $derived(upcoming.filter((s) => daysUntil(s.due, today) < 7))
  const groups = $derived(
    data.accounts
      .filter((a) => !accountFilter || a.id === accountFilter)
      .map((account) => ({
        account,
        items: data.subscriptions.filter(
          (s) =>
            s.accountId === account.id &&
            (!statusFilter || s.status === statusFilter) &&
            `${s.service} ${s.plan} ${account.name} ${account.identifier}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        ),
      }))
      .filter((group) => group.items.length || (!query && !statusFilter) || (!query && statusFilter === 'active' && !data.subscriptions.some((s) => s.accountId === group.account.id))),
  )

  async function request(method = 'GET', body?: Record<string, unknown>) {
    const response = await fetch('/api/subscriptions', {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('กรุณาเข้าสู่ระบบใหม่ แล้วโหลดหน้านี้อีกครั้ง')
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
    return result
  }

  async function refresh() {
    if (!online || refreshing || saving || dialogOpen) return
    refreshing = true
    try {
      data = await request()
      today = getBangkokISODate()
      error = ''
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'โหลดข้อมูลไม่ได้ กรุณาลองใหม่'
    } finally {
      refreshing = false
    }
  }

  onMount(() => {
    const unsubscribe = subscribeConnectivity((state) => {
      online = state.online
    })
    const onFocus = () => {
      today = getBangkokISODate()
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  })

  async function openForm(type: 'account' | 'subscription', item: Subscription | SubscriptionAccount | null = null, accountId = '') {
    kind = type
    editing = item
    defaultAccount = accountId || accountFilter || data.accounts[0]?.id || ''
    formError = ''
    formAmount = item && 'amountMinor' in item ? item.amountMinor / 100 : undefined
    formCurrency = item && 'currency' in item ? item.currency : 'THB'
    formService = item && 'service' in item ? item.service : ''
    formWebsite = item && 'url' in item ? item.url : ''
    iconWebsite = formWebsite
    formAccount = item && 'accountId' in item ? item.accountId : defaultAccount
    formBillingDay = item && 'billingDay' in item ? item.billingDay : Number(getBangkokISODate().slice(-2))
    formBillingInterval = item && 'billingInterval' in item ? item.billingInterval : 'monthly'
    formBillingDate = item && 'billingDate' in item ? (item.billingDate ?? getBangkokISODate()) : getBangkokISODate()
    formStatus = item && 'status' in item ? item.status : 'active'
    dialogOpen = true
    await tick()
    dialog.showModal()
  }

  function suggestService() {
    iconWebsite = formWebsite
    if (formService.trim() || !formWebsite.trim()) return
    try {
      const raw = formWebsite.trim()
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`)
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.')) return
      const name = url.hostname.replace(/^www\./, '').split('.')[0]
      formService = name.charAt(0).toUpperCase() + name.slice(1)
    } catch {
      // Leave validation to the API; never overwrite a name the user entered.
    }
  }

  async function save(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault()
    if (saving || !online) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const payload = {
      ...values,
      kind,
      ...(kind === 'subscription' ? { billingDay: formBillingInterval === 'yearly' ? Number(formBillingDate.slice(-2)) : Number(values.billingDay) } : {}),
      ...(editing ? { id: editing.id, version: editing.version } : {}),
    }
    saving = true
    formError = ''
    notice = ''
    try {
      await request(editing ? 'PATCH' : 'POST', payload)
      dialog.close()
      notice = 'บันทึกแล้ว ทุกคนในบ้านจะเห็นข้อมูลชุดเดียวกัน'
      try {
        data = await request()
        error = ''
      } catch {
        error = 'บันทึกสำเร็จแล้ว แต่โหลดรายการล่าสุดไม่ได้ กรุณากดรีเฟรชข้อมูล'
      }
    } catch (cause) {
      formError = cause instanceof Error ? cause.message : 'ติดต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่'
      if (cause instanceof DOMException || cause instanceof TypeError) formError = 'การเชื่อมต่อขัดข้อง ยังยืนยันผลบันทึกไม่ได้ กรุณาปิดฟอร์มและรีเฟรชรายการก่อนลองอีกครั้ง'
    } finally {
      saving = false
    }
  }

  const serviceEdit = () => (editing && 'service' in editing ? editing : null)
  const accountEdit = () => (editing && 'identifier' in editing ? editing : null)
</script>

<div class="space-y-8">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <p class="flex items-center gap-2 text-xs text-muted-foreground"><Users size={15} strokeWidth={1.5} /> ข้อมูลร่วมกันทั้งบ้าน · แยกตามบัญชีที่สมัครบริการ</p>
    <div class="flex flex-wrap gap-2">
      <button class="btn" disabled={!online || refreshing} onclick={refresh} aria-label="รีเฟรชข้อมูล"><RefreshCw size={15} strokeWidth={1.5} />{refreshing ? 'กำลังโหลด' : 'รีเฟรช'}</button>
      <button class="btn" disabled={!online || !!error} onclick={() => openForm('account')}><Users size={15} strokeWidth={1.5} /> เพิ่มบัญชี</button>
      <button class="btn primary" disabled={!online || !!error || !data.accounts.length} onclick={() => openForm('subscription')}><Plus size={16} strokeWidth={1.5} /> เพิ่มบริการ</button>
    </div>
  </div>

  {#if !online}<p class="rounded-lg border border-border bg-secondary px-4 py-3 text-sm">กำลังดูข้อมูลที่บันทึกไว้ กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อเพิ่มหรือแก้ไขรายการ</p>{/if}
  {#if error}<p role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>{/if}
  {#if notice}<p role="status" class="rounded-lg border border-chart-1/30 bg-chart-1/5 px-4 py-3 text-sm text-foreground">{notice}</p>{/if}

  {#if !loadError || data.accounts.length || !error}
    <section aria-label="ภาพรวมค่าบริการ" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div class="summary">
        <CreditCard size={18} strokeWidth={1.25} class="text-chart-2" />
        <p class="eyebrow mt-5">ค่าบริการต่อเดือน</p>
        <p class="mt-2 font-serif text-3xl font-light">{totals.amountMinor === null ? 'รอเรท' : money(totals.amountMinor, 'THB')}</p>
        <p class="mt-2 text-xs text-muted-foreground">รวมเป็นเงินบาท · รายปีเฉลี่ยเป็นรายเดือน</p>
      </div>
      <div class="summary">
        <CalendarDays size={18} strokeWidth={1.25} class="text-chart-3" />
        <p class="eyebrow mt-5">ประมาณการต่อปี</p>
        <p class="mt-2 font-serif text-3xl font-light">{annualTotals.amountMinor === null ? 'รอเรท' : money(annualTotals.amountMinor, 'THB')}</p>
        <p class="mt-2 text-xs text-muted-foreground">รวมรอบรายเดือนและรายปีตามอัตราปัจจุบัน</p>
      </div>
      <div class="summary">
        <Users size={18} strokeWidth={1.25} class="text-chart-1" />
        <p class="eyebrow mt-5">บริการที่ใช้งานอยู่</p>
        <p class="mt-2 font-serif text-3xl font-light">{active.length}<span class="ml-2 font-sans text-xs text-muted-foreground">บริการ</span></p>
        <p class="mt-2 text-xs text-muted-foreground">จัดเก็บทั้งหมด {data.accounts.length} บัญชี</p>
      </div>
      <div class="summary">
        <CalendarDays size={18} strokeWidth={1.25} class="text-chart-4" />
        <p class="eyebrow mt-5">เรียกเก็บใน 7 วัน</p>
        <p class="mt-2 font-serif text-3xl font-light">{dueSoon.length}<span class="ml-2 font-sans text-xs text-muted-foreground">รายการ</span></p>
        <p class="mt-2 text-xs text-muted-foreground">{upcoming[0] ? `รอบใกล้สุด ${formatThaiDate(upcoming[0].due)}` : 'ยังไม่มีรอบเรียกเก็บ'}</p>
      </div>
    </section>

    <SubscriptionExpenses
      subscriptions={data.subscriptions}
      accounts={data.accounts}
      rate={data.exchangeRate}
      utilities={data.utilities}
      disabled={!online || !!error}
      onedit={(item) => openForm('subscription', item)}
    />
    <div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section class="min-w-0 space-y-5" aria-label="บริการแยกตามบัญชี">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p class="eyebrow">YOUR ACCOUNTS</p>
            <h2 class="mt-1 font-serif text-2xl font-light">บัญชีและบริการ</h2>
          </div>
          <p class="text-xs text-muted-foreground">แสดง {groups.reduce((n, g) => n + g.items.length, 0)} รายการ</p>
        </div>
        <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label class="relative"
            ><span class="sr-only">ค้นหาบริการหรือบัญชี</span><Search size={16} class="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" /><input
              class="field pl-10"
              type="search"
              placeholder="ค้นหาบริการหรือบัญชี"
              bind:value={query}
            /></label
          >
          <label
            ><span class="sr-only">กรองบัญชี</span><select class="field sm:max-w-48" bind:value={accountFilter}
              ><option value="">ทุกบัญชี</option>{#each data.accounts as a (a.id)}<option value={a.id}>{a.name}{a.identifier ? ` · ${a.identifier}` : ''}</option>{/each}</select
            ></label
          >
          <label
            ><span class="sr-only">กรองสถานะ</span><select class="field" bind:value={statusFilter}
              ><option value="">ทุกสถานะ</option>{#each Object.entries(STATUS_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}</select
            ></label
          >
        </div>

        {#each groups as group (group.account.id)}
          <section class="min-w-0">
            <header class="flex items-center justify-between gap-3 border-b border-border/70 py-2">
              <div class="min-w-0">
                <h3 class="break-words text-sm font-medium">{group.account.name}</h3>
                {#if group.account.identifier}<p class="mt-0.5 break-all text-xs text-muted-foreground">{group.account.identifier}</p>{/if}
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button class="list-action" aria-label={`แก้ไขบัญชี ${group.account.name}`} disabled={!online || !!error} onclick={() => openForm('account', group.account)}
                  ><Pencil size={14} strokeWidth={1.5} /></button
                >
                <button class="list-action" aria-label={`เพิ่มบริการให้ ${group.account.name}`} disabled={!online || !!error} onclick={() => openForm('subscription', null, group.account.id)}
                  ><Plus size={16} strokeWidth={1.5} /></button
                >
              </div>
            </header>
            <ul class="divide-y divide-border/50">
              {#each group.items as subscription (subscription.id)}
                <li class="flex items-center gap-3 py-3">
                  <SubscriptionWebsiteIcon website={subscription.url} name={subscription.service} size={28} />
                  <div class="min-w-0 flex-1">
                    <p class="break-words text-sm">
                      {#if subscription.url}<a class="hover:underline underline-offset-4" href={subscription.url} target="_blank" rel="noopener noreferrer"
                          >{subscription.service}<span class="sr-only"> (เปิดเว็บไซต์ในแท็บใหม่)</span></a
                        >{:else}{subscription.service}{/if}
                    </p>
                    <p class="mt-0.5 break-words text-xs text-muted-foreground">
                      {#if subscription.plan}{subscription.plan} ·
                      {/if}{subscription.billingInterval === 'yearly'
                        ? `รายปี · รอบถัดไป ${formatThaiDate(subscriptionBillingDate(subscription, today))}`
                        : `เรียกเก็บวันที่ ${subscription.billingDay}`}{#if subscription.status !== 'active'}
                        · {STATUS_LABELS[subscription.status]}{/if}
                    </p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="text-sm tabular-nums">{baht(subscription)}</p>
                    <p class="mt-0.5 text-[10px] text-muted-foreground">
                      {#if subscription.currency === 'USD'}{money(subscription.amountMinor, 'USD')} USD ·
                      {/if}{subscription.billingInterval === 'yearly' ? 'ต่อปี' : 'ต่อเดือน'}
                    </p>
                  </div>
                  <button
                    class="list-action"
                    aria-label={`แก้ไข ${subscription.service} ของ ${group.account.name}`}
                    disabled={!online || !!error}
                    onclick={() => openForm('subscription', subscription)}><Pencil size={14} strokeWidth={1.5} /></button
                  >
                </li>
              {:else}<li class="py-4 text-sm text-muted-foreground">ยังไม่มีบริการ กด + เพื่อเพิ่มบริการ</li>{/each}
            </ul>
          </section>
        {:else}
          <div class="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
            <CreditCard size={28} strokeWidth={1} class="mx-auto text-accent" />
            <h3 class="mt-4 font-serif text-2xl font-light">{data.accounts.length ? 'ไม่พบรายการที่เลือก' : 'เริ่มจัดระเบียบบริการของบ้าน'}</h3>
            <p class="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              {data.accounts.length ? 'ลองเปลี่ยนคำค้น บัญชี หรือสถานะ เพื่อดูบริการอื่น ๆ' : 'เพิ่มบัญชีที่ใช้สมัครบริการ แล้วบันทึกแพ็กเกจ ค่าบริการ และวันเรียกเก็บไว้ด้วยกัน'}
            </p>
            {#if !data.accounts.length}<button class="btn primary mx-auto mt-6" disabled={!online || !!error} onclick={() => openForm('account')}><Plus size={16} /> เพิ่มบัญชีแรก</button
              >{:else}<button
                class="btn mx-auto mt-6"
                onclick={() => {
                  query = ''
                  accountFilter = ''
                  statusFilter = ''
                }}>แสดงรายการทั้งหมด</button
              >{/if}
          </div>
        {/each}
      </section>

      <aside class="space-y-4">
        <section class="rounded-lg border border-border/70 bg-card p-5 sm:p-6">
          <p class="eyebrow">UPCOMING</p>
          <h2 class="mt-1 font-serif text-xl font-light">รอบเรียกเก็บที่กำลังมาถึง</h2>
          <p class="mt-2 text-xs text-muted-foreground">เรียงตามวัน · สูงสุด 5 รายการ</p>
          <ol class="mt-5 divide-y divide-border/50">
            {#each upcoming.slice(0, 5) as item (item.id)}
              <li class="flex gap-3 py-4 first:pt-0">
                <div class="w-10 shrink-0 text-center">
                  <p class="font-serif text-2xl font-light text-foreground">{Number(item.due.slice(-2))}</p>
                  <p class="mt-1 text-[10px] text-muted-foreground">{daysUntil(item.due, today) === 0 ? 'วันนี้' : `อีก ${daysUntil(item.due, today)} วัน`}</p>
                </div>
                <div class="min-w-0">
                  <p class="flex items-center gap-2 text-sm"><SubscriptionWebsiteIcon website={item.url} name={item.service} size={28} /><span class="break-words">{item.service}</span></p>
                  <p class="mt-1 break-words text-xs text-muted-foreground">{data.accounts.find((a) => a.id === item.accountId)?.name}</p>
                  <p class="mt-2 text-xs">{baht(item)}</p>
                  {#if item.currency === 'USD'}<p class="mt-1 text-[10px] text-muted-foreground">{money(item.amountMinor, 'USD')} USD</p>{/if}
                  <p class="mt-1 text-[10px] text-muted-foreground">{formatThaiDate(item.due)}</p>
                </div>
              </li>
            {:else}<li class="py-5 text-sm text-muted-foreground">ยังไม่มีบริการที่ใช้งานอยู่</li>{/each}
          </ol>
        </section>
        <div class="rounded-lg border border-border/60 p-5 text-xs leading-relaxed text-muted-foreground">
          <p class="text-foreground">วางแผนค่าใช้จ่ายได้ในที่เดียว</p>
          <p class="mt-2">ยอดและรอบเรียกเก็บเป็นข้อมูลที่บันทึกไว้ ไม่ใช่การยืนยันการชำระเงิน หากเดือนใดไม่มีวันที่ 29–31 จะใช้วันสุดท้ายของเดือนนั้น</p>
          <p class="mt-2">การเปลี่ยนสถานะที่นี่เป็นการปรับบันทึก กรุณาพักหรือยกเลิกบริการกับผู้ให้บริการด้วย</p>
        </div>
      </aside>
    </div>
  {/if}
</div>

<dialog
  bind:this={dialog}
  aria-labelledby="subscription-form-title"
  onclose={() => {
    dialogOpen = false
  }}
  oncancel={(event) => {
    if (saving) event.preventDefault()
  }}
  class="subscription-dialog m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground backdrop:bg-black/40"
>
  <div class="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
    <div>
      <h2 id="subscription-form-title" class="mt-1 font-serif text-2xl font-light">{editing ? 'แก้ไข' : 'เพิ่ม'}{kind === 'account' ? 'บัญชีบริการ' : 'บริการ'}</h2>
    </div>
    <button class="btn icon" aria-label="ปิดฟอร์ม" disabled={saving} onclick={() => dialog.close()}><X size={18} /></button>
  </div>
  {#key `${kind}-${editing?.id ?? 'new'}-${defaultAccount}-${dialogOpen}`}
    <form onsubmit={save} class="space-y-5 p-6" aria-labelledby="subscription-form-title">
      {#if formError}<p role="alert" class="text-sm text-destructive">{formError}</p>{/if}
      {#if !online}<p role="status" class="text-sm text-muted-foreground">ออฟไลน์อยู่ กรุณารอการเชื่อมต่อก่อนบันทึก</p>{/if}
      <fieldset disabled={saving || !online} class="space-y-4 disabled:opacity-60">
        {#if kind === 'account'}
          <label class="form-label">ชื่อบัญชี<input class="field" name="name" required maxlength="100" placeholder="เช่น บัญชีส่วนตัว / บัญชีครอบครัว" value={accountEdit()?.name ?? ''} /></label>
          <label class="form-label"
            >อีเมลหรือชื่อผู้ใช้ <span class="optional">(ไม่บังคับ)</span><input
              class="field"
              name="identifier"
              maxlength="254"
              placeholder="name@example.com"
              value={accountEdit()?.identifier ?? ''}
            /></label
          >
        {:else}
          <label class="form-label"
            >เว็บไซต์บริการ <span class="optional">(ไม่บังคับ)</span><span class="mt-2 flex items-center gap-3"
              ><input
                class="field website-field"
                name="url"
                type="text"
                inputmode="url"
                maxlength="2048"
                placeholder="เช่น youtube.com"
                bind:value={formWebsite}
                onblur={suggestService}
              /><SubscriptionWebsiteIcon website={iconWebsite} name={formService} size={48} /></span
            ></label
          >
          <label class="form-label">ชื่อบริการ<input class="field" name="service" required maxlength="100" placeholder="เช่น Netflix" bind:value={formService} /></label>
          <label class="form-label"
            >รอบเรียกเก็บ<select class="field" name="billingInterval" bind:value={formBillingInterval}><option value="monthly">รายเดือน</option><option value="yearly">รายปี</option></select></label
          >
          {#if formBillingInterval === 'yearly'}<label class="form-label">วันที่อ้างอิงรอบรายปี<input class="field" type="date" name="billingDate" required bind:value={formBillingDate} /></label>{/if}
          <div class="grid grid-cols-2 gap-4">
            <label class="form-label"
              >ค่าบริการ{formBillingInterval === 'yearly' ? 'ต่อปี' : 'ต่อเดือน'}<input
                class="field"
                name="amount"
                required
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                inputmode="decimal"
                placeholder="0.00"
                bind:value={formAmount}
              /></label
            >
            <label class="form-label"
              >สกุลเงิน<select class="field" name="currency" required bind:value={formCurrency}
                >{#each CURRENCIES as currency (currency)}<option value={currency}>{currency === 'THB' ? '฿ THB' : '$ USD'}</option>{/each}</select
              ></label
            >
          </div>
          {#if formCurrency === 'USD'}<p class="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3 text-sm" aria-live="polite">
              {formBaht === null ? 'กรอกราคา USD เพื่อดูยอดบาทประมาณการ · ต้องมีเรทอ้างอิง' : `ประมาณ ${money(formBaht, 'THB')} / ${formBillingInterval === 'yearly' ? 'ปี' : 'เดือน'}`}
            </p>{/if}
          <details class="group rounded-xl border border-border/70">
            <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span class="min-w-0"
                ><span class="block text-xs font-medium">รายละเอียดเพิ่มเติม</span><span class="mt-1 block break-words text-[11px] leading-relaxed text-muted-foreground"
                  >{data.accounts.find((a) => a.id === formAccount)?.name} · {formBillingInterval === 'yearly'
                    ? `รายปี ${formatThaiDate(formBillingDate)}`
                    : `รายเดือน วันที่ ${formBillingDay}`}{formStatus !== 'active' ? ` · ${STATUS_LABELS[formStatus]}` : ''}</span
                ></span
              >
              <ChevronDown size={16} class="shrink-0 text-muted-foreground group-open:rotate-180" />
            </summary>
            <div class="space-y-4 border-t border-border/60 p-4">
              <label class="form-label"
                >บัญชีที่สมัครบริการ<select class="field" name="accountId" required bind:value={formAccount}
                  >{#each data.accounts as account (account.id)}<option value={account.id}>{account.name}{account.identifier ? ` · ${account.identifier}` : ''}</option>{/each}</select
                ></label
              >
              <div class="grid grid-cols-2 gap-4">
                <label class="form-label"
                  >เรียกเก็บวันที่<select class="field" name="billingDay" bind:value={formBillingDay}
                    >{#each Array.from({ length: 31 }, (_, i) => i + 1) as day (day)}<option value={day}>วันที่ {day}</option>{/each}</select
                  ></label
                >
                <label class="form-label"
                  >สถานะ<select class="field" name="status" bind:value={formStatus}
                    >{#each Object.entries(STATUS_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}</select
                  ></label
                >
              </div>
              <label class="form-label"
                >แพ็กเกจ <span class="optional">(ไม่บังคับ)</span><input class="field" name="plan" maxlength="100" placeholder="เช่น Premium" value={serviceEdit()?.plan ?? ''} /></label
              >
              <label class="form-label"
                >หมายเหตุ <span class="optional">(ไม่บังคับ)</span><textarea
                  class="field min-h-20 resize-y"
                  name="notes"
                  maxlength="1000"
                  rows="2"
                  placeholder="เช่น ใช้ร่วมกันในครอบครัว"
                  value={serviceEdit()?.notes ?? ''}></textarea></label
              >
            </div>
          </details>
        {/if}
        <button type="submit" class="btn primary w-full">{saving ? 'กำลังบันทึก…' : 'บันทึกข้อมูล'}</button>
      </fieldset>
      <p class="text-center text-[11px] text-muted-foreground">ทุกคนในบ้านเห็นรายการนี้ร่วมกัน</p>
    </form>
  {/key}
</dialog>

<style>
  .subscription-dialog .field {
    min-height: 48px;
    border-radius: 0.75rem;
    background: color-mix(in oklch, var(--secondary) 35%, var(--card));
    font-size: 16px;
  }
  .subscription-dialog .website-field {
    margin-top: 0;
    min-width: 0;
  }
  .subscription-dialog .btn.primary {
    min-height: 48px;
    border-radius: 0.75rem;
    font-size: 14px;
  }
  .subscription-dialog summary:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
    border-radius: 0.75rem;
  }
  .summary {
    border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
    border-radius: var(--radius);
    background: var(--card);
    padding: 1.25rem;
  }
  .eyebrow {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-luxury);
    color: var(--muted-foreground);
  }
  .btn {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--card);
    color: var(--foreground);
    font-size: 12px;
    cursor: pointer;
    transition: background-color 150ms;
  }
  .btn:hover:not(:disabled) {
    background: var(--secondary);
  }
  .btn.primary {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-foreground);
  }
  .btn.primary:hover:not(:disabled) {
    background: color-mix(in oklch, var(--primary) 85%, var(--foreground));
  }
  .btn.icon {
    width: 44px;
    padding: 0;
    flex-shrink: 0;
  }
  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .field {
    display: block;
    width: 100%;
    min-height: 44px;
    border: 1px solid var(--input);
    border-radius: calc(var(--radius) - 2px);
    background: var(--card);
    color: var(--foreground);
    padding: 0.625rem 0.75rem;
    font-size: 14px;
  }
  .field.pl-10 {
    padding-left: 2.5rem;
  }
  .field::placeholder {
    color: var(--muted-foreground);
    opacity: 0.7;
  }
  .form-label {
    display: block;
    font-size: 12px;
  }
  .form-label .field {
    margin-top: 0.5rem;
  }
  .optional {
    color: var(--muted-foreground);
  }
  .list-action {
    display: inline-flex;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .list-action:hover:not(:disabled) {
    background: var(--secondary);
    color: var(--foreground);
  }
  .list-action:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .list-action:focus-visible,
  .btn:focus-visible,
  .field:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .btn {
      transition: none;
    }
  }
</style>
