<script lang="ts">
  let { website, name = '', size = 32 }: { website: string; name?: string; size?: number } = $props()
  let failedUrl = $state('')
  const iconUrl = $derived.by(() => {
    try {
      const raw = website.trim()
      if (!raw) return ''
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return ''
      return `${url.origin}/favicon.ico`
    } catch {
      return ''
    }
  })
</script>

<span class="website-icon" style={`width:${size}px;height:${size}px`} aria-hidden="true">
  {#if iconUrl && failedUrl !== iconUrl}
    {#key iconUrl}<img
        src={iconUrl}
        alt=""
        width={size - 12}
        height={size - 12}
        loading="lazy"
        referrerpolicy="no-referrer"
        onerror={(event) => {
          failedUrl = event.currentTarget.getAttribute('src') ?? ''
        }}
      />{/key}
  {:else}
    <span>{name.trim().slice(0, 1).toUpperCase() || '↗'}</span>
  {/if}
</span>

<style>
  .website-icon {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--card);
    color: var(--foreground);
    font-size: 16px;
  }
  img {
    display: block;
    object-fit: contain;
  }
</style>
