<script>
  import LogOut from '@lucide/svelte/icons/log-out'
  import { clearOfflineCaches } from '@/lib/connectivity'

  let loading = $state(false)

  async function logout() {
    loading = true
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      // HTML ที่ service worker เก็บไว้เป็นข้อมูลของบ้าน — ออกจากระบบแล้วต้องไม่เหลือค้างในเครื่อง
      await clearOfflineCaches()
    } finally {
      window.location.href = '/login'
    }
  }
</script>

<button
  type="button"
  onclick={logout}
  disabled={loading}
  aria-label="ออกจากระบบ"
  class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
>
  <LogOut size={16} strokeWidth={1.25} />
</button>
