import { describe, expect, test } from 'bun:test'
import { normalizeAuthEmail } from './auth-email'

describe('normalizeAuthEmail', () => {
  test('keeps a valid email unchanged', () => {
    expect(normalizeAuthEmail('kingkan.pop@gmail.com')).toBe('kingkan.pop@gmail.com')
  })

  test('removes an accidental backslash before the at sign', () => {
    expect(normalizeAuthEmail(String.raw`kingkan.pop\@gmail.com`)).toBe('kingkan.pop@gmail.com')
  })

  test('trims whitespace copied with the email', () => {
    expect(normalizeAuthEmail('  kingkan.pop@gmail.com\n')).toBe('kingkan.pop@gmail.com')
  })
})
