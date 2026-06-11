/**
 * 生成 latest.json 更新清单
 *
 * Tauri plugin-updater 期望的格式:
 * {
 *   "version": "0.11.0",
 *   "notes": "版本说明",
 *   "pub_date": "ISO8601 时间",
 *   "platforms": {
 *     "darwin-aarch64": {
 *       "signature": "<.sig 文件内容的 base64 编码>",
 *       "url": "<更新包下载地址>"
 *     },
 *     "darwin-x86_64": {
 *       "signature": "...",
 *       "url": "..."
 *     }
 *   }
 * }
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const artifactsDir = path.join(rootDir, 'update-artifacts')

// 从 action 参数获取 tag 名（如 v0.11.0）
const tagName = process.argv[2] || 'v0.0.0'
const cleanVersion = tagName.replace(/^v/, '')

const files = fs.existsSync(artifactsDir) ? fs.readdirSync(artifactsDir) : []

function findFile(pattern) {
  return files.find(f => f.includes(pattern) && !f.endsWith('.sig')) ?? null
}

function readSignature(sigFile) {
  if (!sigFile) return ''
  const fullPath = path.join(artifactsDir, sigFile)
  if (!fs.existsSync(fullPath)) return ''
  return fs.readFileSync(fullPath, 'utf-8').trim()
}

// 查找构建产物的实际文件名
const aarch64TarGz = findFile('aarch64') || findFile('arm64')
const x8664TarGz   = findFile('x86_64') || findFile('x64')

const aarch64SigFile = files.find(f => f.includes('aarch64') && f.endsWith('.sig'))
                          || files.find(f => f.includes('arm64') && f.endsWith('.sig'))
const x8664SigFile   = files.find(f => f.includes('x86_64') && f.endsWith('.sig'))
                          || files.find(f => f.includes('x64') && f.endsWith('.sig'))

const baseUrl = `https://github.com/Aprilming/maiknote/releases/download/${tagName}`

const manifest = {
  version: cleanVersion,
  notes: `MaikNote ${cleanVersion} - Release notes: https://github.com/Aprilming/maiknote/releases/tag/${tagName}`,
  pub_date: new Date().toISOString(),
  platforms: {},
}

if (aarch64TarGz) {
  manifest.platforms['darwin-aarch64'] = {
    signature: readSignature(aarch64SigFile),
    url: `${baseUrl}/${aarch64TarGz}`,
  }
}

if (x8664TarGz) {
  manifest.platforms['darwin-x86_64'] = {
    signature: readSignature(x8664SigFile),
    url: `${baseUrl}/${x8664TarGz}`,
  }
}

const outputPath = path.join(rootDir, 'latest.json')
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2))
console.log('Generated latest.json:')
console.log(JSON.stringify(manifest, null, 2))
