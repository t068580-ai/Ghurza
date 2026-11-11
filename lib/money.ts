// Money is stored as integer fils (1 KWD = 1000 fils). Never floats.

export function formatKWD(fils: number): string {
  const sign = fils < 0 ? '-' : ''
  const abs = Math.abs(fils)
  const whole = Math.floor(abs / 1000)
  const frac = String(abs % 1000).padStart(3, '0')
  return `${sign}${whole.toLocaleString('en-US')}.${frac} KWD`
}

// "12", "12.5" or "12.500" -> fils, using string math only. Max 99,999.999 KWD.
export function parseKWDToFils(input: string): number | null {
  const s = input.trim()
  if (!/^\d{1,5}(\.\d{1,3})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  return Number(whole) * 1000 + Number(frac.padEnd(3, '0'))
}

export function filsToInput(fils: number): string {
  const whole = Math.floor(fils / 1000)
  const frac = String(fils % 1000).padStart(3, '0')
  return `${whole}.${frac}`
}
