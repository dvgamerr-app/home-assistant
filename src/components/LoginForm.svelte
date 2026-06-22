<script>
  let { githubEnabled = false } = $props()
  let email = $state('')
  let password = $state('')
  let error = $state('')
  let loading = $state(false)

  async function signIn(e) {
    e.preventDefault()
    loading = true
    error = ''
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        window.location.href = '/'
      } else {
        const data = await res.json().catch(() => ({}))
        error = data.message ?? 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมลและรหัสผ่าน'
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

<form onsubmit={signIn} class="space-y-5">
  {#if error}
    <p class="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>
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
      autocomplete="current-password"
      class="w-full rounded-md border border-border/70 bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-accent"
    />
  </div>

  <button
    type="submit"
    disabled={loading}
    class="w-full rounded-md border border-accent/60 bg-accent/10 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
  >
    {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
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
