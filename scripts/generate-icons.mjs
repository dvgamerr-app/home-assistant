/**
 * สร้างไอคอน PNG ของ PWA จาก SVG ต้นฉบับใน public/
 *
 * รันเมื่อแก้ public/icon.svg หรือ public/icons/icon-maskable.svg เท่านั้น:
 *   bun scripts/generate-icons.mjs
 *
 * ใช้ sharp ที่ติดมากับ astro (ไม่ได้เป็น dependency ตรงของโปรเจกต์)
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))

/** @type {{ src: string; out: string; size: number }[]} */
const TARGETS = [
  { src: 'public/icon.svg', out: 'public/icons/icon-192.png', size: 192 },
  { src: 'public/icon.svg', out: 'public/icons/icon-512.png', size: 512 },
  { src: 'public/icon.svg', out: 'public/icons/apple-touch-icon.png', size: 180 },
  { src: 'public/icons/icon-maskable.svg', out: 'public/icons/icon-maskable-512.png', size: 512 },
  { src: 'public/icon.svg', out: 'public/favicon.png', size: 64 },
]

for (const { src, out, size } of TARGETS) {
  const svg = await readFile(root + src)
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 250, g: 246, b: 239, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(root + out, png)
  console.log(`${out} — ${size}x${size} (${(png.length / 1024).toFixed(1)} kB)`)
}
