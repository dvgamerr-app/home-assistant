<script>
  let { githubEnabled = false, initialError = '' } = $props()
  let mode = $state('signin')
  let name = $state('')
  let email = $state('')
  let password = $state('')
  let error = $state(initialError)
  let loading = $state(false)

  function toThaiError(message, currentMode) {
    if (!message) {
      return currentMode === 'signup' ? 'สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' : 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมลและรหัสผ่าน'
    }

    const normalized = String(message).toLowerCase()
    if (normalized.includes('user already exists')) return 'อีเมลนี้ถูกใช้งานแล้ว กรุณาเข้าสู่ระบบหรือใช้อีเมลอื่น'
    if (normalized.includes('invalid email')) return 'รูปแบบอีเมลไม่ถูกต้อง'
    if (normalized.includes('password too short')) return 'รหัสผ่านสั้นเกินไป กรุณาตั้งอย่างน้อย 8 ตัวอักษร'
    if (normalized.includes('password too long')) return 'รหัสผ่านยาวเกินไป กรุณาลองใหม่อีกครั้ง'
    if (normalized.includes('invalid password')) return 'รหัสผ่านไม่ถูกต้อง'
    if (normalized.includes('sign up is not enabled')) return 'ระบบยังไม่เปิดรับสมัครด้วยอีเมล'
    return message
  }

  function switchMode(nextMode) {
    mode = nextMode
    error = ''
  }

  async function submitEmail(e) {
    e.preventDefault()
    loading = true
    error = ''
    const signup = mode === 'signup'
    try {
      const res = await fetch(signup ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signup ? { name, email, password } : { email, password }),
      })
      if (res.ok) {
        window.location.href = '/'
      } else {
        const data = await res.json().catch(() => ({}))
        error = toThaiError(data.message, mode)
      }
    } catch {
      error = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
    } finally {
      loading = false
    }
  }

  async function signInGitHub() {
    loading = true
    error = ''
    try {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.url) {
        window.location.href = data.url
      } else {
        error = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
        loading = false
      }
    } catch {
      error = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
      loading = false
    }
  }
</script>

<div class="mb-5 grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-background/60 p-1">
  <button
    type="button"
    onclick={() => switchMode('signin')}
    class:list={['rounded-md px-3 py-2 text-sm transition-colors', mode === 'signin' ? 'border border-accent/60 bg-accent/10 text-foreground' : 'text-muted-foreground hover:bg-card']}
  >
    เข้าสู่ระบบ
  </button>
  <button
    type="button"
    onclick={() => switchMode('signup')}
    class:list={['rounded-md px-3 py-2 text-sm transition-colors', mode === 'signup' ? 'border border-accent/60 bg-accent/10 text-foreground' : 'text-muted-foreground hover:bg-card']}
  >
    สมัครสมาชิก
  </button>
</div>

<form onsubmit={submitEmail} class="space-y-5">
  {#if error}
    <p class="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>
  {/if}

  {#if mode === 'signup'}
    <div class="space-y-1.5">
      <label for="name" class="text-[10px] uppercase tracking-luxury text-muted-foreground">ชื่อที่แสดง</label>
      <input
        id="name"
        type="text"
        bind:value={name}
        required={mode === 'signup'}
        autocomplete="name"
        class="w-full rounded-md border border-border/70 bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-accent"
      />
    </div>
  {/if}

  <div class="space-y-1.5">
    <label for="email" class="text-[10px] uppercase tracking-luxury text-muted-foreground">อีเมล</label>
    <input
      id="email"
      type="email"
      bind:value={email}
      required
      autocomplete="email"
      class="w-full rounded-md border border-border/70 bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-accent"
    />
  </div>

  <div class="space-y-1.5">
    <label for="password" class="text-[10px] uppercase tracking-luxury text-muted-foreground">รหัสผ่าน</label>
    <input
      id="password"
      type="password"
      bind:value={password}
      required
      autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
      class="w-full rounded-md border border-border/70 bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-accent"
    />
    {#if mode === 'signup'}
      <p class="text-xs text-muted-foreground">แนะนำอย่างน้อย 8 ตัวอักษร เพื่อให้ระบบสร้างบัญชีได้สมบูรณ์</p>
    {/if}
  </div>

  <button
    type="submit"
    disabled={loading}
    class="w-full rounded-md border border-accent/60 bg-accent/10 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
  >
    {#if loading}
      {mode === 'signup' ? 'กำลังสร้างบัญชี…' : 'กำลังเข้าสู่ระบบ…'}
    {:else}
      {mode === 'signup' ? 'สร้างบัญชีด้วยอีเมล' : 'เข้าสู่ระบบ'}
    {/if}
  </button>
</form>

{#if githubEnabled}
  <div class="relative my-6 flex items-center gap-4">
    <div class="h-px flex-1 bg-border/60"></div>
    <span class="text-[10px] uppercase tracking-luxury text-muted-foreground">หรือ</span>
    <div class="h-px flex-1 bg-border/60"></div>
  </div>

  <button
    type="button"
    onclick={signInGitHub}
    disabled={loading}
    class="flex w-full items-center justify-center gap-3 rounded-md border border-border/70 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-card disabled:opacity-50"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z"
      />
    </svg>
    เข้าสู่ระบบด้วย GitHub
  </button>
{/if}
