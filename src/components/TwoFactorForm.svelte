<script>
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'

  let mode = $state('totp')
  let code = $state('')
  let error = $state('')
  let loading = $state(false)

  function thaiError(data) {
    const errorCode = String(data?.code ?? '').toUpperCase()
    if (errorCode === 'INVALID_CODE') return 'รหัสไม่ถูกต้อง กรุณาใช้รหัสล่าสุดจากแอป Authenticator'
    if (errorCode === 'INVALID_BACKUP_CODE') return 'Recovery code ไม่ถูกต้องหรือถูกใช้ไปแล้ว'
    if (errorCode === 'ACCOUNT_TEMPORARILY_LOCKED') return 'มีการลองรหัสผิดหลายครั้ง บัญชีถูกพักชั่วคราว กรุณารอสักครู่แล้วลองใหม่'
    if (errorCode === 'INVALID_TWO_FACTOR_COOKIE' || errorCode === 'TOTP_NOT_ENABLED') return 'คำขอยืนยันหมดอายุแล้ว กรุณากลับไปเข้าสู่ระบบใหม่'
    return data?.message || 'ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
  }

  function switchMode(nextMode) {
    mode = nextMode
    code = ''
    error = ''
  }

  async function verify(event) {
    event.preventDefault()
    loading = true
    error = ''
    const endpoint = mode === 'totp' ? '/api/auth/two-factor/verify-totp' : '/api/auth/two-factor/verify-backup-code'
    const body = mode === 'totp' ? { code: code.replace(/\s/g, ''), trustDevice: true } : { code: code.trim(), disableSession: false, trustDevice: true }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        window.location.href = '/'
      } else {
        error = thaiError(data)
      }
    } catch {
      error = 'เชื่อมต่อระบบยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
    } finally {
      loading = false
    }
  }
</script>

<div class="space-y-6">
  <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-accent/50 bg-accent/10 text-accent">
    {#if mode === 'totp'}
      <ShieldCheck size={25} strokeWidth={1.25} />
    {:else}
      <KeyRound size={24} strokeWidth={1.25} />
    {/if}
  </div>

  <div class="space-y-2 text-center">
    <p class="text-[10px] uppercase tracking-luxury text-muted-foreground">Security check</p>
    <h2 class="font-serif text-2xl font-light text-foreground">{mode === 'totp' ? 'ยืนยันอีกหนึ่งขั้นตอน' : 'ใช้ Recovery code'}</h2>
    <p class="text-sm leading-relaxed text-muted-foreground">
      {mode === 'totp' ? 'กรอกรหัส 6 หลักล่าสุดจากแอป Authenticator' : 'กรอกรหัสสำรองหนึ่งชุดที่บันทึกไว้ตอนเปิด 2FA'}
    </p>
  </div>

  <form onsubmit={verify} class="space-y-5">
    {#if error}
      <p class="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>
    {/if}

    <div class="space-y-1.5">
      <label for="two-factor-code" class="text-[10px] uppercase tracking-luxury text-muted-foreground">
        {mode === 'totp' ? 'รหัสจาก Authenticator' : 'Recovery code'}
      </label>
      <input
        id="two-factor-code"
        bind:value={code}
        type="text"
        required
        minlength={mode === 'totp' ? 6 : undefined}
        maxlength={mode === 'totp' ? 6 : undefined}
        inputmode={mode === 'totp' ? 'numeric' : 'text'}
        pattern={mode === 'totp' ? '[0-9]{6}' : undefined}
        autocomplete="one-time-code"
        placeholder={mode === 'totp' ? '000000' : 'xxxx-xxxxxx'}
        class:list={[
          'w-full rounded-md border border-border/70 bg-background px-4 py-3 text-center font-mono text-foreground outline-none focus:border-accent',
          mode === 'totp' ? 'text-xl tracking-[0.4em]' : 'text-base tracking-wider',
        ]}
      />
    </div>

    <button
      type="submit"
      disabled={loading}
      class="w-full rounded-md border border-accent/60 bg-accent/10 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
    >
      {loading ? 'กำลังตรวจสอบ…' : 'ยืนยันและเข้าสู่ระบบ'}
    </button>
  </form>

  <div class="space-y-3 border-t border-border/60 pt-5 text-center">
    <button type="button" onclick={() => switchMode(mode === 'totp' ? 'backup' : 'totp')} class="text-xs text-muted-foreground transition-colors hover:text-foreground">
      {mode === 'totp' ? 'ไม่มีโทรศัพท์? ใช้ Recovery code' : 'กลับไปใช้รหัส Authenticator'}
    </button>
    <a href="/login" class="mx-auto flex w-fit items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft size={14} strokeWidth={1.25} />
      กลับไปเข้าสู่ระบบใหม่
    </a>
  </div>
</div>
