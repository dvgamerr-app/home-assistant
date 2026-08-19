<script>
  import Check from '@lucide/svelte/icons/check'
  import Clipboard from '@lucide/svelte/icons/clipboard'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole'
  import QrCode from '@lucide/svelte/icons/qr-code'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import UserRound from '@lucide/svelte/icons/user-round'
  import QRCode from 'qrcode'

  let { initialName, email, initialTwoFactorEnabled = false, hasPassword = false, hasGitHub = false, githubEnabled = false, initialGitHubMessage = '', initialGitHubError = '' } = $props()

  let name = $state((() => initialName)())
  let profileError = $state('')
  let profileMessage = $state('')
  let profileLoading = $state(false)
  let githubMessage = $state((() => initialGitHubMessage)())
  let githubError = $state((() => initialGitHubError)())
  let githubLoading = $state(false)

  let twoFactorEnabled = $state((() => initialTwoFactorEnabled)())
  let securityStep = $state('idle')
  let securityError = $state('')
  let securityLoading = $state(false)
  let currentPassword = $state('')
  let totpCode = $state('')
  let totpURI = $state('')
  let qrDataURL = $state('')
  let backupCodes = $state([])
  let copied = $state(false)

  function thaiAuthError(data, fallback) {
    const code = String(data?.code ?? '').toUpperCase()
    const message = String(data?.message ?? '').toLowerCase()

    if (code === 'INVALID_PASSWORD' || message.includes('invalid password')) return 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
    if (code === 'INVALID_CODE' || message.includes('invalid code')) return 'รหัสจากแอป Authenticator ไม่ถูกต้อง กรุณาลองรหัสล่าสุดอีกครั้ง'
    if (code === 'ACCOUNT_TEMPORARILY_LOCKED') return 'มีการลองรหัสผิดหลายครั้ง บัญชีถูกพักชั่วคราว กรุณารอสักครู่แล้วลองใหม่'
    if (code === 'TOTP_NOT_ENABLED') return 'การตั้งค่านี้หมดอายุแล้ว กรุณาเริ่มเปิด 2FA ใหม่อีกครั้ง'
    return data?.message || fallback
  }

  async function request(path, body) {
    const response = await fetch(`/api/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw data
    return data
  }

  async function saveProfile(event) {
    event.preventDefault()
    const nextName = name.trim()
    profileError = ''
    profileMessage = ''

    if (nextName.length < 2) {
      profileError = 'กรุณากรอกชื่อที่แสดงอย่างน้อย 2 ตัวอักษร'
      return
    }
    if (nextName.length > 80) {
      profileError = 'ชื่อที่แสดงต้องยาวไม่เกิน 80 ตัวอักษร'
      return
    }

    profileLoading = true
    try {
      await request('/update-user', { name: nextName })
      name = nextName
      profileMessage = 'บันทึกชื่อที่แสดงแล้ว'
    } catch (cause) {
      profileError = cause?.message || 'บันทึกโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
    } finally {
      profileLoading = false
    }
  }

  async function linkGitHub() {
    githubError = ''
    githubMessage = ''
    githubLoading = true

    try {
      const data = await request('/link-social', {
        provider: 'github',
        callbackURL: '/settings?github=linked',
        errorCallbackURL: '/settings?github=error',
        disableRedirect: true,
      })

      if (data.url) {
        window.location.href = data.url
        return
      }

      githubError = 'ไม่สามารถเริ่มการเชื่อมบัญชี GitHub ได้ กรุณาลองใหม่อีกครั้ง'
    } catch (cause) {
      githubError = cause?.message || 'เชื่อมบัญชี GitHub ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
    } finally {
      githubLoading = false
    }
  }

  function openSecurityStep(step) {
    securityStep = step
    securityError = ''
    currentPassword = ''
    totpCode = ''
  }

  async function startTwoFactor(event) {
    event.preventDefault()
    securityError = ''
    securityLoading = true
    try {
      const data = await request('/two-factor/enable', { password: currentPassword, issuer: 'OurKK' })
      totpURI = data.totpURI
      backupCodes = data.backupCodes ?? []
      qrDataURL = await QRCode.toDataURL(data.totpURI, {
        width: 224,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#2f2b26', light: '#ffffff' },
      })
      currentPassword = ''
      securityStep = 'verify'
    } catch (cause) {
      securityError = thaiAuthError(cause, 'เริ่มตั้งค่า 2FA ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      securityLoading = false
    }
  }

  async function verifyTwoFactor(event) {
    event.preventDefault()
    securityError = ''
    const normalizedCode = totpCode.replace(/[^0-9]/g, '')

    if (!/^[0-9]{6}$/.test(normalizedCode)) {
      securityError = 'กรุณากรอกรหัสตัวเลข 6 หลักจากแอป Authenticator'
      return
    }

    securityLoading = true
    try {
      await request('/two-factor/verify-totp', { code: normalizedCode, trustDevice: true })
      twoFactorEnabled = true
      totpCode = ''
      securityStep = 'backup'
    } catch (cause) {
      securityError = thaiAuthError(cause, 'ยืนยัน 2FA ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      securityLoading = false
    }
  }

  async function disableTwoFactor(event) {
    event.preventDefault()
    securityError = ''
    securityLoading = true
    try {
      await request('/two-factor/disable', { password: currentPassword })
      twoFactorEnabled = false
      currentPassword = ''
      securityStep = 'idle'
    } catch (cause) {
      securityError = thaiAuthError(cause, 'ปิด 2FA ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      securityLoading = false
    }
  }

  async function copyBackupCodes() {
    await navigator.clipboard.writeText(backupCodes.join('\n'))
    copied = true
    setTimeout(() => (copied = false), 2000)
  }

  function finishEnrollment() {
    window.location.href = '/settings'
  }

  function totpSecret() {
    try {
      return new URL(totpURI).searchParams.get('secret') ?? ''
    } catch {
      return ''
    }
  }
</script>

<div class="grid gap-5 lg:grid-cols-2">
  <section class="rounded-xl border border-border/70 bg-card" aria-labelledby="profile-title">
    <header class="flex items-start gap-4 border-b border-border/60 px-6 py-5">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
        <UserRound size={18} strokeWidth={1.25} />
      </span>
      <div>
        <p class="text-[10px] uppercase tracking-luxury text-muted-foreground">Profile</p>
        <h2 id="profile-title" class="mt-1 font-serif text-xl font-light text-foreground">ข้อมูลที่แสดงในบ้าน</h2>
      </div>
    </header>

    <form onsubmit={saveProfile} class="space-y-5 p-6">
      {#if profileError}
        <p class="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">{profileError}</p>
      {/if}
      {#if profileMessage}
        <p class="flex items-center gap-2 rounded-md border border-chart-1/40 bg-chart-1/5 px-4 py-3 text-sm text-chart-1">
          <Check size={15} strokeWidth={1.5} />
          {profileMessage}
        </p>
      {/if}

      <div class="space-y-1.5">
        <label for="display-name" class="text-[10px] uppercase tracking-luxury text-muted-foreground">ชื่อที่แสดง</label>
        <input
          id="display-name"
          bind:value={name}
          type="text"
          required
          minlength="2"
          maxlength="80"
          autocomplete="name"
          class="w-full rounded-md border border-border/70 bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-accent"
        />
        <p class="text-xs text-muted-foreground">ใช้ในแถบเมนูและคำทักทายภายในแดชบอร์ด</p>
      </div>

      <div class="space-y-1.5">
        <label for="account-email" class="text-[10px] uppercase tracking-luxury text-muted-foreground">อีเมลบัญชี</label>
        <input
          id="account-email"
          value={email}
          type="email"
          readonly
          class="w-full cursor-not-allowed rounded-md border border-border/60 bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground outline-none"
        />
        <p class="text-xs text-muted-foreground">อีเมลเป็นตัวระบุบัญชีและยังเปลี่ยนจากหน้านี้ไม่ได้</p>
      </div>

      {#if githubEnabled}
        <div class="space-y-3 rounded-md border border-border/70 bg-background/60 p-4">
          <div class="flex items-start gap-3">
            <svg class="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path
                d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z"
              />
            </svg>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-foreground">เข้าสู่ระบบด้วย GitHub</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                {hasGitHub ? 'บัญชี GitHub เชื่อมกับบัญชีนี้แล้ว' : 'เชื่อมหลังเข้าสู่ระบบ เพื่อยืนยันว่าเป็นเจ้าของทั้งสองบัญชี'}
              </p>
            </div>
          </div>

          {#if githubError}
            <p class="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive">{githubError}</p>
          {/if}
          {#if githubMessage}
            <p class="flex items-center gap-2 rounded-md border border-chart-1/40 bg-chart-1/5 px-3 py-2 text-xs text-chart-1">
              <Check size={14} strokeWidth={1.5} />
              {githubMessage}
            </p>
          {/if}

          {#if !hasGitHub}
            <button
              type="button"
              onclick={linkGitHub}
              disabled={githubLoading}
              class="rounded-md border border-accent/60 bg-accent/10 px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              {githubLoading ? 'กำลังเชื่อมต่อ…' : 'เชื่อม GitHub'}
            </button>
          {/if}
        </div>
      {/if}

      <button
        type="submit"
        disabled={profileLoading}
        class="rounded-md border border-accent/60 bg-accent/10 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
      >
        {profileLoading ? 'กำลังบันทึก…' : 'บันทึกโปรไฟล์'}
      </button>
    </form>
  </section>

  <section class="rounded-xl border border-border/70 bg-card" aria-labelledby="security-title">
    <header class="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
      <div class="flex items-start gap-4">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
          <ShieldCheck size={18} strokeWidth={1.25} />
        </span>
        <div>
          <p class="text-[10px] uppercase tracking-luxury text-muted-foreground">Security</p>
          <h2 id="security-title" class="mt-1 font-serif text-xl font-light text-foreground">การยืนยันสองขั้นตอน</h2>
        </div>
      </div>
      <span
        class:list={[
          'mt-1 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider',
          twoFactorEnabled ? 'border-chart-1/40 bg-chart-1/5 text-chart-1' : 'border-border/70 text-muted-foreground',
        ]}
      >
        {twoFactorEnabled ? 'เปิดอยู่' : 'ยังไม่เปิด'}
      </span>
    </header>

    <div class="p-6">
      {#if securityError}
        <p class="mb-5 rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">{securityError}</p>
      {/if}

      {#if securityStep === 'idle'}
        <div class="space-y-5">
          <p class="text-sm leading-relaxed text-muted-foreground">ใช้รหัส 6 หลักจากแอป Authenticator เพิ่มอีกชั้นเมื่อเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน</p>

          {#if twoFactorEnabled}
            <div class="flex items-start gap-3 rounded-md border border-chart-1/35 bg-chart-1/5 p-4">
              <ShieldCheck class="mt-0.5 shrink-0 text-chart-1" size={18} strokeWidth={1.25} />
              <div>
                <p class="text-sm font-medium text-foreground">บัญชีนี้มี 2FA ป้องกันอยู่</p>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">อุปกรณ์ที่เชื่อถือจะจำการยืนยันไว้ 30 วัน</p>
              </div>
            </div>
            <button
              type="button"
              onclick={() => openSecurityStep('disable')}
              class="rounded-md border border-destructive/40 px-5 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/5"
            >
              ปิดการยืนยันสองขั้นตอน
            </button>
          {:else if hasPassword}
            <button
              type="button"
              onclick={() => openSecurityStep('enable')}
              class="rounded-md border border-accent/60 bg-accent/10 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20"
            >
              เปิดใช้งาน 2FA
            </button>
          {:else}
            <div class="space-y-4 rounded-md border border-border/70 bg-background/60 p-4">
              <div class="flex items-start gap-3">
                <KeyRound class="mt-0.5 shrink-0 text-muted-foreground" size={18} strokeWidth={1.25} />
                <p class="text-sm leading-relaxed text-muted-foreground">เพิ่มการเข้าสู่ระบบด้วยรหัสผ่านก่อน เพื่อใช้ยืนยันตอนเปิด 2FA</p>
              </div>
              <a href="/account/set-password" class="inline-flex rounded-md border border-accent/60 bg-accent/10 px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent/20"
                >เพิ่มรหัสผ่าน</a
              >
            </div>
          {/if}
        </div>
      {:else if securityStep === 'enable'}
        <form onsubmit={startTwoFactor} class="space-y-5">
          <div class="flex items-start gap-3">
            <LockKeyhole class="mt-0.5 shrink-0 text-accent" size={19} strokeWidth={1.25} />
            <div>
              <p class="text-sm font-medium text-foreground">ยืนยันก่อนเริ่มตั้งค่า</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">กรอกรหัสผ่านปัจจุบันเพื่อสร้างกุญแจ TOTP ใหม่</p>
            </div>
          </div>
          <div class="space-y-1.5">
            <label for="enable-password" class="text-[10px] uppercase tracking-luxury text-muted-foreground">รหัสผ่านปัจจุบัน</label>
            <input
              id="enable-password"
              bind:value={currentPassword}
              type="password"
              required
              autocomplete="current-password"
              class="w-full rounded-md border border-border/70 bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={securityLoading}
              class="rounded-md border border-accent/60 bg-accent/10 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              {securityLoading ? 'กำลังสร้าง…' : 'สร้างรหัสสำหรับ Authenticator'}
            </button>
            <button type="button" onclick={() => openSecurityStep('idle')} class="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground">ยกเลิก</button>
          </div>
        </form>
      {:else if securityStep === 'verify'}
        <form onsubmit={verifyTwoFactor} novalidate class="space-y-5">
          <div class="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
            <div class="mx-auto rounded-lg border border-border/70 bg-white p-2">
              {#if qrDataURL}
                <img src={qrDataURL} alt="QR code สำหรับตั้งค่า OurKK ในแอป Authenticator" width="208" height="208" />
              {:else}
                <div class="flex h-52 w-52 items-center justify-center text-muted-foreground"><QrCode size={32} strokeWidth={1} /></div>
              {/if}
            </div>
            <div class="space-y-3">
              <div>
                <p class="text-sm font-medium text-foreground">1. สแกน QR code</p>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">ใช้ Google Authenticator, 1Password หรือแอป TOTP ที่คุณใช้อยู่</p>
              </div>
              <div class="rounded-md border border-border/60 bg-background/60 p-3">
                <p class="text-[10px] uppercase tracking-luxury text-muted-foreground">Manual key</p>
                <code class="mt-1 block break-all text-xs text-foreground">{totpSecret()}</code>
              </div>
            </div>
          </div>

          <div class="space-y-1.5">
            <label for="totp-code" class="text-[10px] uppercase tracking-luxury text-muted-foreground">2. รหัส 6 หลักจากแอป</label>
            <input
              id="totp-code"
              bind:value={totpCode}
              type="text"
              required
              maxlength="6"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder="000000"
              class="w-full rounded-md border border-border/70 bg-background px-4 py-3 font-mono text-lg tracking-[0.35em] text-foreground outline-none focus:border-accent"
            />
          </div>

          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={securityLoading}
              class="rounded-md border border-accent/60 bg-accent/10 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              {securityLoading ? 'กำลังตรวจสอบ…' : 'ยืนยันและเปิด 2FA'}
            </button>
            <button type="button" onclick={() => openSecurityStep('idle')} class="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground">ยกเลิก</button>
          </div>
        </form>
      {:else if securityStep === 'backup'}
        <div class="space-y-5">
          <div class="flex items-start gap-3 rounded-md border border-chart-1/35 bg-chart-1/5 p-4">
            <ShieldCheck class="mt-0.5 shrink-0 text-chart-1" size={19} strokeWidth={1.25} />
            <div>
              <p class="text-sm font-medium text-foreground">เปิด 2FA เรียบร้อยแล้ว</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">เก็บ recovery codes ไว้ในที่ปลอดภัย แต่ละรหัสใช้ได้เพียงครั้งเดียว</p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 rounded-md border border-border/70 bg-background p-4 font-mono text-xs text-foreground">
            {#each backupCodes as backupCode (backupCode)}
              <code class="rounded border border-border/50 bg-card px-2 py-1.5 text-center">{backupCode}</code>
            {/each}
          </div>

          <div class="flex flex-wrap gap-3">
            <button
              type="button"
              onclick={copyBackupCodes}
              class="inline-flex items-center gap-2 rounded-md border border-border/70 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background"
            >
              {#if copied}<Check size={15} strokeWidth={1.5} /> คัดลอกแล้ว{:else}<Clipboard size={15} strokeWidth={1.25} /> คัดลอกทั้งหมด{/if}
            </button>
            <button
              type="button"
              onclick={finishEnrollment}
              class="rounded-md border border-accent/60 bg-accent/10 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20">เสร็จสิ้น</button
            >
          </div>
        </div>
      {:else if securityStep === 'disable'}
        <form onsubmit={disableTwoFactor} class="space-y-5">
          <div>
            <p class="text-sm font-medium text-foreground">ปิดการยืนยันสองขั้นตอน</p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">หลังปิด ระบบจะลบกุญแจ TOTP และ recovery codes ชุดปัจจุบัน</p>
          </div>
          <div class="space-y-1.5">
            <label for="disable-password" class="text-[10px] uppercase tracking-luxury text-muted-foreground">รหัสผ่านปัจจุบัน</label>
            <input
              id="disable-password"
              bind:value={currentPassword}
              type="password"
              required
              autocomplete="current-password"
              class="w-full rounded-md border border-border/70 bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={securityLoading}
              class="rounded-md border border-destructive/40 px-5 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50"
            >
              {securityLoading ? 'กำลังปิด…' : 'ยืนยันการปิด 2FA'}
            </button>
            <button type="button" onclick={() => openSecurityStep('idle')} class="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground">ยกเลิก</button>
          </div>
        </form>
      {/if}
    </div>
  </section>
</div>
