export interface ExpenseTile {
  id: string
  amountMinor: number
  x: number
  y: number
  width: number
  height: number
}

/** สัดส่วนพื้นที่ขั้นต่ำของแต่ละกล่อง เพื่อให้รายการเล็กๆ ยังพอแสดงไอคอนกับ % ได้ */
const MIN_AREA_SHARE = 0.06

/** Balanced binary treemap. Tile areas track converted THB amounts (floored at MIN_AREA_SHARE), not mixed currencies. */
export function expenseTiles(items: { id: string; amountMinor: number }[]): ExpenseTile[] {
  const positive = items.filter((item) => item.amountMinor > 0)
  const grand = positive.reduce((sum, item) => sum + item.amountMinor, 0)
  // ถ้ารายการเยอะจน floor รวมเกินพื้นที่ ให้ลด floor ลงตามจำนวน
  const floor = grand * Math.min(MIN_AREA_SHARE, 0.5 / Math.max(positive.length, 1))
  const sorted = positive.map((item) => ({ ...item, weight: Math.max(item.amountMinor, floor) })).toSorted((a, b) => b.weight - a.weight || b.amountMinor - a.amountMinor || a.id.localeCompare(b.id))
  const result: ExpenseTile[] = []
  const split = (values: typeof sorted, x: number, y: number, width: number, height: number) => {
    if (!values.length) return
    if (values.length === 1) {
      result.push({ id: values[0].id, amountMinor: values[0].amountMinor, x, y, width, height })
      return
    }
    const total = values.reduce((sum, item) => sum + item.weight, 0)
    let partial = values[0].weight
    let index = 1
    while (index < values.length - 1 && Math.abs(total / 2 - partial - values[index].weight) < Math.abs(total / 2 - partial)) {
      partial += values[index].weight
      index++
    }
    const fraction = partial / total
    if (width * 1.6 >= height) {
      split(values.slice(0, index), x, y, width * fraction, height)
      split(values.slice(index), x + width * fraction, y, width * (1 - fraction), height)
    } else {
      split(values.slice(0, index), x, y, width, height * fraction)
      split(values.slice(index), x, y + height * fraction, width, height * (1 - fraction))
    }
  }
  split(sorted, 0, 0, 100, 100)
  return result
}
