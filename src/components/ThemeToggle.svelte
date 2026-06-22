<script>
  import Sun from '@lucide/svelte/icons/sun'
  import Moon from '@lucide/svelte/icons/moon'

  // ponytail: icon visibility is driven purely by the `.dark` class via Tailwind's dark: variant —
  // no reactive state, so no SSR/hydration mismatch and nothing to keep in sync.
  function toggle() {
    const dark = document.documentElement.classList.toggle('dark')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }
</script>

<button
  type="button"
  onclick={toggle}
  aria-label="สลับโหมดสว่าง / มืด"
  class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
>
  <Moon class="block dark:hidden" size={16} strokeWidth={1.5} />
  <Sun class="hidden dark:block" size={16} strokeWidth={1.5} />
</button>
