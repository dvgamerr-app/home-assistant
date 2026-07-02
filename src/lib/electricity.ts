// MEA (การไฟฟ้านครหลวง) residential tariff calculation helpers.
// Reference: MEA residential rate type 1.2 (use > 150 units/month), progressive ("ขั้นบันได") tariff.
// Energy charge tiers (THB per unit / kWh):
//   0 - 150 units      : 3.2484
//   151 - 400 units    : 4.2218
//   over 400 units     : 4.4217
// Plus Ft charge, monthly service charge, then 7% VAT.

export const MONTH_SHORT_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const MONTH_LONG_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

export const MEA_TIERS = [
  { upTo: 150, rate: 3.2484 },
  { upTo: 400, rate: 4.2218 },
  { upTo: Infinity, rate: 4.4217 },
]

export const FT_RATE = 0.1972 // THB/unit (current Ft period, approx)
export const SERVICE_CHARGE = 38.22 // THB/month for type 1.2
export const VAT_RATE = 0.07

/**
 * Compute the MEA bill for a given monthly consumption (kWh).
 * Returns a full breakdown so the UI can explain "why" the bill is what it is.
 */
export function calculateMonthlyBill(units: number) {
  let remaining = Math.max(0, units)
  let energyCharge = 0
  let lastCap = 0

  for (const tier of MEA_TIERS) {
    if (remaining <= 0) break
    const tierSize = tier.upTo - lastCap
    const consumed = Math.min(remaining, tierSize)
    energyCharge += consumed * tier.rate
    remaining -= consumed
    lastCap = tier.upTo
  }

  const ftCharge = units * FT_RATE
  const subtotal = energyCharge + ftCharge + SERVICE_CHARGE
  const vat = subtotal * VAT_RATE
  const total = subtotal + vat

  return {
    units,
    energyCharge,
    ftCharge,
    serviceCharge: SERVICE_CHARGE,
    subtotal,
    vat,
    total,
    // effective average price per unit (incl. everything)
    effectiveRate: units > 0 ? total / units : 0,
  }
}

/**
 * Marginal price of one extra/avoided unit at a given monthly usage level.
 * Used to value solar self-consumption realistically (it offsets the top tier first).
 */
export function marginalRate(monthlyUnits: number) {
  const tier = MEA_TIERS.find((t) => monthlyUnits <= t.upTo) ?? MEA_TIERS.at(-1)!
  return (tier.rate + FT_RATE) * (1 + VAT_RATE)
}

export function thb(value: number, digits = 0) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function num(value: number, digits = 1) {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}
