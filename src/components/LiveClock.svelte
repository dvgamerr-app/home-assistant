<script>
  let now = $state(new Date())

  $effect(() => {
    const id = setInterval(() => (now = new Date()), 30_000)
    return () => clearInterval(id)
  })

  const dateFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' })
  const timeFmt = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })

  let label = $derived(`${dateFmt.format(now)} · ${timeFmt.format(now)} น.`)
</script>

<span>{label}</span>
