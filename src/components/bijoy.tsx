'use client'

import { useEffect, useId, useRef, useState } from 'react'

/*
 * SutonnyMJ / classic Bijoy plain-text converter.
 * No remote conversion API, runtime package or automatic English guessing.
 * Mapping fixtures checked against bangla.plus on 2026-10-04.
 * Original implementation; see the included README for scope and limitations.
 */
export type ConversionMode = 'uni2bijoy' | 'bijoy2uni'
export type ConversionResult = { text: string; warnings: string[] }
type Pair = readonly [string, string]

const H = '\u09cd'
const ZWNJ = '\u200c'
const ZWJ = '\u200d'
// Internal reph marker is carried as a token, never inserted into user text.
type Glyph = { text: string; reph?: boolean }
const C = '[ক-নপ-রলশ-হড়ঢ়য়]'
const CLUSTER = `${C}(?:্${C})*`
const clusterRE = new RegExp(`^${CLUSTER}`)
const consonantRE = new RegExp(`^${C}$`)
const bengaliRE = /[\u0980-\u09ff]/
const MAX_INPUT = 200_000

const BASIC: Pair[] = [
  ['অ','A'],['আ','Av'],['ই','B'],['ঈ','C'],['উ','D'],['ঊ','E'],
  ['ঋ','F'],['এ','G'],['ঐ','H'],['ও','I'],['ঔ','J'],
  ['ক','K'],['খ','L'],['গ','M'],['ঘ','N'],['ঙ','O'],['চ','P'],
  ['ছ','Q'],['জ','R'],['ঝ','S'],['ঞ','T'],['ট','U'],['ঠ','V'],
  ['ড','W'],['ঢ','X'],['ণ','Y'],['ত','Z'],['থ','_'],['দ','`'],
  ['ধ','a'],['ন','b'],['প','c'],['ফ','d'],['ব','e'],['ভ','f'],
  ['ম','g'],['য','h'],['র','i'],['ল','j'],['শ','k'],['ষ','l'],
  ['স','m'],['হ','n'],['ড়','o'],['ঢ়','p'],['য়','q'],['ৎ','r'],
  ['ং','s'],['ঃ','t'],['ঁ','u'],
  ['০','0'],['১','1'],['২','2'],['৩','3'],['৪','4'],
  ['৫','5'],['৬','6'],['৭','7'],['৮','8'],['৯','9'],
  ['া','v'],['ি','w'],['ী','x'],['ু','y'],['ূ','~'],['ৃ','„'],
  ['ে','‡'],['ৈ','‰'],['ৗ','Š'],['্','&'],['।','|'],['॥','\\'],
]

// Full conjuncts are matched before their constituent consonants/phalas.
const CONJUNCTS: Pair[] = [
  ['ক্ক','°'],['ক্ট','±'],['ক্ত','³'],['ক্ম','´'],['ক্র','µ'],
  ['ক্ল','K¬'],['ক্ষ','¶'],['ক্ষ্ণ','¶è'],['ক্ষ্ম','²'],['ক্স','·'],['ক্ব','K¡'],
  ['খ্র','Lª'],['গ্ধ','»'],['গ্ন','Mœ'],['গ্ম','M¥'],['গ্র','MÖ'],['গ্ল','Mø'],
  ['ঙ্ক','¼'],['ঙ্ক্ষ','•¶'],['ঙ্খ','•L'],['ঙ্গ','½'],['ঙ্ঘ','•N'],
  ['চ্চ','”P'],['চ্ছ','”Q'],['চ্ছ্ব','”Q¡'],['চ্ঞ','”T'],
  ['জ্জ','¾'],['জ্জ্ব','¾¡'],['জ্ঝ','À'],['জ্ঞ','Á'],['জ্ব','R¡'],['জ্র','Rª'],
  ['ঞ্চ','Â'],['ঞ্ছ','Ã'],['ঞ্জ','Ä'],['ঞ্ঝ','Å'],
  ['ট্ট','Æ'],['ট্ব','U¡'],['ট্ম','U¥'],['ট্র','Uª'],['ড্ড','Ç'],['ড্র','Wª'],
  ['ণ্ট','È'],['ণ্ঠ','É'],['ণ্ড','Ð'],['ণ্ব','Y^'],['ণ্ণ','Yœ'],['ণ্ন','Y&b'],
  ['ত্ত','Ë'],['ত্ত্ব','Ë¡'],['ত্থ','Ì'],['ত্ন','Zœ'],['ত্ম','Z¥'],['ত্ব','Z¡'],['ত্র','Î'],
  ['থ্ব','_¡'],['থ্র','_ª'],['দ্গ','˜M'],['দ্ঘ','˜N'],['দ্দ','Ï'],
  ['দ্ধ','×'],['দ্ব','Ø'],['দ্ভ','™¢'],['দ্ম','Ù'],['দ্র','`ª'],['ধ্ব','aŸ'],['ধ্র','aª'],
  ['ন্ট','›U'],['ন্ট্র','›Uª'],['ন্ঠ','Ú'],['ন্ড','Û'],['ন্ড্র','Ûª'],
  ['ন্ত','šÍ'],['ন্ত্ব','šÍ¡'],['ন্ত্র','š¿'],['ন্থ','š’'],
  ['ন্দ','›`'],['ন্দ্ব','›Ø'],['ন্দ্র','›`ª'],['ন্ধ','Ü'],['ন্ধ্র','Üª'],
  ['ন্ন','bœ'],['ন্ব','š^'],['ন্ম','b¥'],['ন্স','Ý'],
  ['প্ট','Þ'],['প্ত','ß'],['প্ন','cœ'],['প্প','à'],['প্ল','cø'],['প্স','á'],['প্র','cÖ'],
  ['ফ্ল','d¬'],['ফ্র','d«'],['ব্জ','â'],['ব্দ','ã'],['ব্ধ','ä'],['ব্ব','eŸ'],['ব্ল','eø'],['ব্র','eª'],
  ['ভ্র','å'],['ম্ন','gœ'],['ম্প','¤ú'],['ম্প্র','¤úª'],['ম্ফ','ç'],
  ['ম্ব','¤^'],['ম্ভ','¤¢'],['ম্ভ্র','¤£'],['ম্ম','¤§'],['ম্ল','¤ø'],['ম্র','gª'],
  ['ল্ক','é'],['ল্গ','ê'],['ল্ট','ë'],['ল্ড','ì'],['ল্প','í'],['ল্ফ','î'],
  ['ল্ব','j¦'],['ল্ম','j¥'],['ল্ল','jø'],
  ['শ্চ','ð'],['শ্ছ','ñ'],['শ্ন','kœ'],['শ্ব','k¦'],['শ্ম','k¥'],['শ্ল','kø'],['শ্র','kÖ'],
  ['ষ্ক','®‹'],['ষ্ট','ó'],['ষ্ঠ','ô'],['ষ্ণ','ò'],['ষ্প','®ú'],['ষ্ফ','õ'],['ষ্ম','®§'],
  ['স্ক','¯‹'],['স্ক্র','¯Œ'],['স্খ','ö'],['স্ট','÷'],['স্ত','¯Í'],['স্ত্র','¯¿'],['স্থ','¯’'],
  ['স্ন','mœ'],['স্প','¯ú'],['স্প্র','¯úª'],['স্ফ','ù'],['স্ব','¯^'],['স্ম','¯§'],['স্ল','¯ø'],['স্র','mÖ'],
  ['হ্ণ','nè'],['হ্ন','ý'],['হ্ব','nŸ'],['হ্ম','þ'],['হ্ল','n¬'],['হ্র','nª'],
]

const PHALAS: Pair[] = [['্য','¨'],['্র','ª'],['্ল','¬'],['্ব','¡'],['্ম','¥'],['্ন','œ']]
const SPECIAL: Pair[] = [['গু','¸'],['শু','ï'],['হু','û'],['হৃ','ü'],['রু','iæ'],['রূ','iƒ']]

// Read-only aliases: several legacy glyph forms represent the same Unicode text.
// Never mechanically reverse this table to choose output glyphs.
const ALIASES: Pair[] = [
  ['†','ে'],['ˆ','ৈ'],['z','ু'],['–','ু'],['‚','ূ'],['ƒ','ূ'],['…','ৃ'],['æ','ু'],
  ['•','ঙ্'],['”','চ্'],['˜','দ্'],['™','দ্'],['š','ন্'],['›','ন্'],
  ['¤','ম্'],['®','ষ্'],['¯','স্'],['‹','্ক'],['Œ','্ক্র'],
  ['‘','্তু'],['’','্থ'],['Í','্ত'],['—','্ত'],['¿','্ত্র'],
  ['Ÿ','্ব'],['¦','্ব'],['^','্ব'],['¢','্ভ'],['£','্ভ্র'],['§','্ম'],
  ['Ö','্র'],['«','্র'],['ø','্ল'],['\u00ad','্ল'],['è','্ণ'],['ú','্প'],
  ['º','গ্দ'],['¹','জ্ঞ'],['Ê','ণ্ড'],['ÿ','ক্ষ'],['ç','ম্ফ'],
  ['Ñ','—'],['Ò','“'],['Ó','”'],['Ô','‘'],['Õ','’'],
]
const PUNCTUATION: Pair[] = [['—','Ñ'],['“','Ò'],['”','Ó'],['‘','Ô'],['’','Õ']]

function longest(entries: Pair[]): Pair[] {
  return [...entries].sort((a, b) => b[0].length - a[0].length)
}
const forward = longest([...CONJUNCTS, ...PHALAS, ...BASIC])
const baseMap = new Map(BASIC)
// Exact reverse conjuncts deliberately win over generic glyph decomposition.
const reverseMap = new Map<string, string>(ALIASES)
for (const [u, b] of [...BASIC, ...PHALAS, ...CONJUNCTS, ...SPECIAL]) reverseMap.set(b, u)
// Prefer the full ণ্ণ ligature over generic ণ + ন-phala expansion.
// The rare literal ণ্ন sequence is emitted as Y&b to keep it distinct.
const reverse = longest([...reverseMap])

/** Bengali canonical equivalence, without normalizing unrelated scripts. */
export function normalizeBangla(text: string): string {
  return text.replace(/[\u0980-\u09ff]+/g, run => run.normalize('NFC'))
    .replace(/ড\u09bc/g, 'ড়').replace(/ঢ\u09bc/g, 'ঢ়').replace(/য\u09bc/g, 'য়')
}

function checkInput(text: string): void {
  if (typeof text !== 'string') throw new TypeError('Input must be a string.')
  if (text.length > MAX_INPUT) throw new RangeError(`Please convert at most ${MAX_INPUT.toLocaleString()} UTF-16 code units at once.`)
}

function mapCluster(cluster: string, warnings: Set<string>): string {
  const output: string[] = []
  for (let i = 0; i < cluster.length;) {
    const pair = forward.find(([key]) => cluster.startsWith(key, i))
    if (pair) {
      if (pair[0] === H && consonantRE.test(cluster[i + 1] ?? '')) {
        warnings.add(`No verified ligature mapping for “${cluster}”. Its letters were preserved with an explicit hasanta; review this specific cluster in your font.`)
      }
      output.push(pair[1]); i += pair[0].length
    } else { output.push(cluster[i++]) }
  }
  return output.join('')
}

function bottomVowel(cluster: string, vowel: string): string {
  // Glyph positioning depends on the final base/ligature shape.
  if (cluster.endsWith('্য')) cluster = cluster.slice(0, -2)
  const last = cluster.at(-1) ?? ''
  if (vowel === 'ু') {
    if (cluster === 'র') return 'æ'
    if ('ড়ঢ়'.includes(last)) return '–'
    return 'কচছঝটঠডঢতফভ'.includes(last) ? 'z' : 'y'
  }
  if (vowel === 'ূ') {
    if (cluster === 'র') return 'ƒ'
    return 'কচছঝটঠডঢতফভ'.includes(last) ? '‚' : '~'
  }
  return 'কঙচছঝঞটঠডঢতফভরড়ঢ়য়'.includes(last) ? '…' : '„'
}

function encode(text: string, warnings: Set<string>): string {
  text = normalizeBangla(text)
  const out: string[] = []
  for (let i = 0; i < text.length;) {
    const start = i
    // Bengali RA + joiner + hasanta + YA: explicit non-reph form.
    const explicitRa = text.slice(i).match(/^র([\u200c\u200d])্য/)
    let cluster = explicitRa ? explicitRa[0] : text.slice(i).match(clusterRE)?.[0]
    if (cluster) {
      i += cluster.length
      const reph = !explicitRa && cluster.startsWith('র্') && cluster.length > 2
      if (reph) cluster = cluster.slice(2)
      let vowel = ''
      let nasal = ''
      // Accept both vowel+chandrabindu and chandrabindu+vowel spellings.
      if (text[i] === 'ঁ') { nasal = 'u'; i++ }
      if (/[ািীুূৃেৈোৌ]/.test(text[i] ?? '')) vowel = text[i++]
      if (text[i] === 'ঁ' && !nasal) { nasal = 'u'; i++ }
      let glyph = explicitRa ? 'i' + (explicitRa[1] === ZWJ ? ZWJ : '') + '¨' : mapCluster(cluster, warnings)
      const special = !reph && !explicitRa && SPECIAL.find(([u]) => u === cluster + vowel)
      let before = ''
      let after = ''
      if (special) glyph = special[1]
      else if (vowel === 'ি') before = 'w'
      else if (vowel === 'ে' || vowel === 'ো' || vowel === 'ৌ') {
        before = start === 0 || /[\s([{]/.test(text[start - 1]) ? '†' : '‡'
        after = vowel === 'ো' ? 'v' : vowel === 'ৌ' ? 'Š' : ''
      } else if (vowel === 'ৈ') before = 'ˆ'
      else if ('ুূৃ'.includes(vowel) && vowel) {
        // Ya-phala is visually to the right of an attached bottom vowel.
        if (cluster.endsWith('্য') && !reph && !explicitRa) {
          const stem = cluster.slice(0, -2)
          glyph = mapCluster(stem, warnings) + bottomVowel(stem, vowel) + '¨'
        } else after = bottomVowel(cluster, vowel)
      } else if (vowel) after = baseMap.get(vowel) ?? vowel
      out.push(before, glyph, reph ? '©' : '', after === 'v' ? nasal + after : after + nasal)
      continue
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    const mapped = baseMap.get(ch) ?? PUNCTUATION.find(([u]) => u === ch)?.[1]
    if (mapped !== undefined) {
      if (/[ািীুূৃেৈোৌৗ]/.test(ch)) warnings.add('A vowel sign has no preceding supported consonant cluster; review the input.')
      out.push(mapped)
    } else {
      if (bengaliRE.test(ch)) warnings.add('Unsupported Bengali characters were preserved as Unicode; this is not entirely legacy Bijoy text.')
      else if (reverseMap.has(ch) || ch === '©') warnings.add('Some preserved non-Bengali characters share Bijoy glyph positions. Keep their original font runs; plain text cannot distinguish them during reverse conversion.')
      out.push(ch)
    }
    i += ch.length
  }
  if (/[\u200c\u200d]/.test(text)) warnings.add('Joiner characters were retained where possible. Their visual effect varies between legacy fonts and applications.')
  return out.join('')
}

function decode(text: string, warnings: Set<string>): string {
  const tokens: Glyph[] = []
  for (let i = 0; i < text.length;) {
    if (text[i] === '©') { tokens.push({ text: '', reph: true }); i++; continue }
    // Canonical non-reph RA+ya-phala sequences, before generic matching.
    if (text.startsWith('i' + ZWJ + '¨', i)) {
      tokens.push({ text: 'র' + ZWJ + '্য' }); i += 3; continue
    }
    if (text.startsWith('i¨', i)) {
      tokens.push({ text: 'র' + ZWNJ + '্য' }); i += 2; continue
    }
    const pair = reverse.find(([key]) => text.startsWith(key, i))
    if (pair) { tokens.push({ text: pair[1] }); i += pair[0].length }
    else {
      const ch = String.fromCodePoint(text.codePointAt(i)!)
      if (/[\u0080-\u009f]/.test(ch)) warnings.add('C1 control codes detected: decode the source bytes as Windows-1252 before converting.')
      else if (/[\u00a0-\u00ff\u2000-\u206f]/.test(ch) && !/\s|[\u200c\u200d]/.test(ch)) {
        warnings.add('Unrecognized legacy symbols were preserved. Check the source font/encoding.')
      }
      tokens.push({ text: ch }); i += ch.length
    }
  }
  // Expand glyph fragments, then reconstruct logical consonant clusters.
  const chars: Glyph[] = tokens.flatMap(t => t.reph ? [t] : Array.from(t.text, c => ({ text: c })))
  const out: string[] = []
  for (let i = 0; i < chars.length;) {
    const current = chars[i]
    if (current.reph) {
      warnings.add('A reph marker has no preceding cluster; it was preserved for review.')
      out.push('©'); i++; continue
    }
    let pre = ''
    if (/[িেৈ]/.test(current.text)) pre = chars[i++].text
    if (!consonantRE.test(chars[i]?.text ?? '')) {
      if (pre) { out.push(pre); warnings.add('A pre-base vowel has no following consonant cluster; review the source.') }
      else { out.push(current.text); i++ }
      continue
    }
    let cluster = chars[i++].text
    while (chars[i]?.text === H) {
      if (consonantRE.test(chars[i + 1]?.text ?? '')) {
        cluster += H + chars[i + 1].text; i += 2
      } else break
    }
    // Explicit RA joiner+ya-phala comes from one legacy sequence.
    if (cluster === 'র' && /[\u200c\u200d]/.test(chars[i]?.text ?? '') && chars[i + 1]?.text === H && chars[i + 2]?.text === 'য') {
      cluster += chars[i].text + H + 'য'; i += 3
    }
    let reph = false
    let vowel = ''
    let nasal = ''
    // Legacy writers place reph on either side of post-base vowel signs.
    while (i < chars.length) {
      if (chars[i].reph && !reph) { reph = true; i++; continue }
      const c = chars[i].text
      if (c === 'ঁ' && !nasal) { nasal = c; i++; continue }
      if (/[াীুূৃৗ]/.test(c) && !vowel) { vowel = c; i++; continue }
      // e.g. Kz¨ (ক্যু): bottom vowel before ya-phala.
      if (c === H && chars[i + 1]?.text === 'য') { cluster += '্য'; i += 2; continue }
      break
    }
    if (pre === 'ে' && vowel === 'া') { pre = 'ো'; vowel = '' }
    else if (pre === 'ে' && vowel === 'ৗ') { pre = 'ৌ'; vowel = '' }
    else if (pre && vowel) warnings.add('Conflicting vowel signs detected; both were preserved for review.')
    out.push(reph ? 'র্' : '', cluster, pre, vowel, nasal)
  }
  return normalizeBangla(out.join(''))
}

function decodeMixed(text: string, warnings: Set<string>): string {
  // This protects actual Unicode Bengali, not indistinguishable English ASCII.
  return text.split(/([\u0980-\u09ff][\u0980-\u09ff\u200c\u200d]*)/g)
    .map((run, i) => i % 2 ? run : decode(run, warnings)).join('')
}

/** Strict policy: the selected Bijoy input is legacy Bangla, including ASCII digits. */
export function convertDetailed(text: string, mode: ConversionMode): ConversionResult {
  checkInput(text)
  const warnings = new Set<string>()
  const converted = mode === 'uni2bijoy' ? encode(text, warnings) : decodeMixed(text, warnings)
  if (mode === 'uni2bijoy') {
    // Verify Bangla runs independently so genuine English text doesn't create false failures.
    const runs = normalizeBangla(text).match(/[\u0980-\u09ff\u200c\u200d]+/g) ?? []
    for (const run of runs) {
      const scratch = new Set<string>()
      const back = decodeMixed(encode(run, scratch), scratch)
      if (normalizeBangla(back) !== normalizeBangla(run)) {
        warnings.add('At least one Bangla run does not round-trip exactly. Review the result before publishing.')
        break
      }
    }
    if (/[A-Za-z0-9]/.test(text)) warnings.add('English letters/digits were preserved. Use separate font runs in your destination document; a later plain-text reverse conversion cannot identify them automatically.')
  }
  return { text: converted, warnings: [...warnings] }
}

export function convertUnicodeToBijoy(text: string): string {
  return convertDetailed(text, 'uni2bijoy').text
}
export function convertBijoyToUnicode(text: string): string {
  return convertDetailed(text, 'bijoy2uni').text
}

// UI begins here. Pure conversion functions above can also be moved to a .ts module.

// Pinned CDN revision: local installed fonts are deliberately not used.
const SUTONNY_CDN_URL = 'https://cdn.jsdelivr.net/gh/stepupitbd/Bangla-fonts@759c838fd24c727b33315e20f0472ae4bffbb467/SUTOM___.TTF'

// Included CSS: no Tailwind installation or generated utility classes required.
const CONVERTER_CSS = `
.bc-root, .bc-root * { box-sizing: border-box; }
.bc-root { color: #1e293b; background: #fff; border: 1px solid #dbe2ea; border-radius: 16px; padding: 24px; font-family: Arial, sans-serif; width: 100%; max-width: 1400px; margin: 0 auto; color-scheme: light; }
.bc-root .bc-heading { margin: 0; font-size: 21px; font-weight: 700; line-height: 1.4; }
.bc-root .bc-subtitle { margin: 6px 0 0; color: #64748b; font-size: 14px; line-height: 1.6; }
.bc-root .bc-header { padding-bottom: 18px; border-bottom: 1px solid #e2e8f0; }
.bc-root .bc-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 18px 0 12px; }
.bc-root .bc-direction { margin: 0; font-size: 14px; font-weight: 700; }
.bc-root .bc-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.bc-root .bc-toggle input { accent-color: #334155; width: 16px; height: 16px; }
.bc-root .bc-help { margin: 0 0 18px; color: #64748b; font-size: 13px; line-height: 1.7; }
.bc-root .bc-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 132px minmax(0, 1fr); gap: 18px; align-items: stretch; }
.bc-root .bc-panel { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.bc-root .bc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; }
.bc-root .bc-label { font-size: 14px; font-weight: 700; }
.bc-root .bc-button { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 42px; padding: 10px 15px; margin: 0; border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; color: #334155; font: 600 14px/1.3 Arial, sans-serif; cursor: pointer; white-space: nowrap; }
.bc-root .bc-button:hover:not(:disabled) { background: #f1f5f9; }
.bc-root .bc-button:focus-visible, .bc-root .bc-editor:focus-visible { outline: 3px solid #94a3b8; outline-offset: 2px; }
.bc-root .bc-button:disabled { opacity: 0.45; cursor: not-allowed; }
.bc-root .bc-copy { background: #f8fafc; min-width: 82px; }
.bc-root .bc-primary { background: #1e293b; color: #fff; border-color: #1e293b; }
.bc-root .bc-primary:hover:not(:disabled) { background: #0f172a; }
.bc-root .bc-editor { display: block; width: 100%; height: 320px; min-height: 220px; resize: vertical; border: 1px solid #cbd5e1; border-radius: 10px; padding: 15px; margin: 0; color: #0f172a; background: #f8fafc; font-size: 19px; line-height: 1.8; text-align: left; }
.bc-root .bc-editor[readonly] { background: #f1f5f9; }
.bc-root .bc-controls { display: flex; flex-direction: column; justify-content: center; align-items: stretch; gap: 12px; padding-top: 52px; }
.bc-root .bc-mobile-arrow { display: none; }
.bc-root .bc-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; margin-top: 18px; }
.bc-root .bc-font-note { margin: 0; color: #64748b; font-size: 12px; line-height: 1.6; max-width: 580px; }
.bc-root .bc-secondary-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.bc-root .bc-status { margin: 14px 0 0; min-height: 20px; font-size: 13px; line-height: 1.5; color: #475569; }
.bc-root .bc-notes { margin: 12px 0 0; padding: 12px 16px; border: 1px solid #fcd34d; border-radius: 9px; background: #fffbeb; color: #78350f; font-size: 13px; line-height: 1.7; }
.bc-root .bc-notes summary { cursor: pointer; font-weight: 600; }
.bc-root .bc-notes ul { margin: 8px 0 0; padding-left: 20px; }
@media (max-width: 760px) {
  .bc-root { padding: 16px; }
  .bc-root .bc-workspace { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .bc-root .bc-controls { flex-direction: row; justify-content: center; padding-top: 0; }
  .bc-root .bc-controls .bc-button { min-width: 120px; }
  .bc-root .bc-desktop-arrow { display: none; }
  .bc-root .bc-mobile-arrow { display: inline; }
  .bc-root .bc-editor { height: 270px; }
}
`

export default function BijoyConverter() {
  const id = useId()
  const [inputText, setInputText] = useState('')
  const [outputText, setOutputText] = useState('')
  const [mode, setMode] = useState<ConversionMode>('uni2bijoy')
  const [warnings, setWarnings] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [copied, setCopied] = useState<'input' | 'output' | null>(null)
  const [rawBijoy, setRawBijoy] = useState(false)
  const [fontStatus, setFontStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // Per-instance family avoids collisions with global CSS and other instances.
  const fontFamily = `BijoyConverterSutonny_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  useEffect(() => {
    let active = true
    let font: FontFace | undefined
    const timeout = setTimeout(() => { if (active) setFontStatus('error') }, 15000)
    const load = async () => {
      try {
        font = new FontFace(fontFamily, `url("${SUTONNY_CDN_URL}")`, {
          style: 'normal', weight: '400', display: 'swap',
        })
        await font.load()
        if (!active) return
        document.fonts.add(font)
        setFontStatus('ready')
      } catch {
        if (active) setFontStatus('error')
      } finally {
        clearTimeout(timeout)
      }
    }
    void load()
    return () => {
      active = false
      clearTimeout(timeout)
      if (font) document.fonts.delete(font)
    }
  }, [fontFamily])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const outputRef = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++; if (timer.current) clearTimeout(timer.current) }, [])

  const resetStatus = () => {
    generation.current++
    if (timer.current) clearTimeout(timer.current)
    setCopied(null); setStatus(''); setWarnings([])
  }
  const convert = (selectionOnly = false) => {
    resetStatus()
    try {
      const start = inputRef.current?.selectionStart ?? 0
      const end = inputRef.current?.selectionEnd ?? 0
      if (selectionOnly && start === end) { setStatus('Select the text you want to convert first.'); return }
      const source = selectionOnly ? inputText.slice(start, end) : inputText
      const result = convertDetailed(source, mode)
      setOutputText(selectionOnly ? inputText.slice(0, start) + result.text + inputText.slice(end) : result.text)
      setWarnings(result.warnings)
      setStatus(result.warnings.length ? 'Converted. Please review the notes below.' : 'Converted.')
    } catch (error) {
      setOutputText('')
      setStatus(error instanceof Error ? error.message : 'Conversion failed.')
    }
  }
  const copy = async (field: 'input' | 'output') => {
    const text = field === 'input' ? inputText : outputText
    const fieldRef = field === 'input' ? inputRef : outputRef
    if (!text) return
    const request = ++generation.current
    if (timer.current) clearTimeout(timer.current)
    setCopied(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      if (request !== generation.current) return
      setCopied(field); setStatus(`${field === 'input' ? 'Input' : 'Output'} copied to clipboard.`)
      timer.current = setTimeout(() => setCopied(null), 2000)
    } catch {
      if (request !== generation.current) return
      fieldRef.current?.focus(); fieldRef.current?.select()
      setStatus(`Automatic copy is unavailable. The ${field} is selected; press Ctrl+C or Command+C.`)
    }
  }
  const changeMode = () => {
    resetStatus()
    setMode(m => m === 'uni2bijoy' ? 'bijoy2uni' : 'uni2bijoy')
    // Preserve an unconverted draft; do not replace it with an empty result.
    if (outputText) setInputText(outputText)
    setOutputText('')
  }
  const bijoyStyle = {
    fontFamily: rawBijoy || fontStatus !== 'ready' ? 'ui-monospace, monospace' : `"${fontFamily}"`,
    fontSize: rawBijoy || fontStatus !== 'ready' ? '19px' : '22px',
    fontWeight: 400, fontStyle: 'normal', fontSynthesis: 'none',
    letterSpacing: 'normal', textTransform: 'none',
  } as const
  const unicodeStyle = { fontFamily: '"Noto Sans Bengali", "Hind Siliguri", sans-serif' }
  return (
    <section className="bc-root" data-version="4" aria-labelledby={`${id}-title`}>
      <style>{CONVERTER_CSS}</style>
      <header className="bc-header">
        <h2 id={`${id}-title`} className="bc-heading">Bijoy &amp; Unicode Converter</h2>
        <p className="bc-subtitle">Convert Bangla text between Unicode and classic Bijoy / SutonnyMJ.</p>
      </header>
      <div className="bc-toolbar">
        <p className="bc-direction">{mode === 'uni2bijoy' ? 'Unicode → Bijoy' : 'Bijoy → Unicode'}</p>
        <label className="bc-toggle">
          <input type="checkbox" checked={rawBijoy} onChange={e => setRawBijoy(e.target.checked)} />
          Show raw Bijoy codes
        </label>
      </div>
      <p id={`${id}-help`} className="bc-help">
        {mode === 'bijoy2uni'
          ? 'For mixed English and Bijoy text, select only the Bijoy portion and choose Convert selection.'
          : 'Paste Unicode Bangla on the left, then select Convert. Use SutonnyMJ for the converted Bangla in your design software.'}
      </p>
      <div className="bc-workspace">
        <div className="bc-panel">
          <div className="bc-panel-head">
            <label htmlFor={`${id}-input`} className="bc-label">{mode === 'uni2bijoy' ? 'Unicode input' : 'Bijoy input'}</label>
            <button type="button" className="bc-button bc-copy" disabled={!inputText} onClick={() => copy('input')} aria-label="Copy input text">
              {copied === 'input' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <textarea ref={inputRef} id={`${id}-input`} rows={10} value={inputText} spellCheck={false}
            aria-describedby={`${id}-help`} placeholder="Type or paste text here…"
            style={mode === 'uni2bijoy' ? unicodeStyle : bijoyStyle} className="bc-editor"
            onChange={e => { resetStatus(); setInputText(e.target.value); setOutputText('') }}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); convert() } }} />
        </div>
        <div className="bc-controls" role="group" aria-label="Conversion controls">
          <button type="button" onClick={changeMode} className="bc-button" aria-label="Switch conversion direction">
            <span aria-hidden="true">⇄</span> Switch
          </button>
          <button type="button" className="bc-button bc-primary" disabled={!inputText} onClick={() => convert()}>
            Convert <span className="bc-desktop-arrow" aria-hidden="true">→</span><span className="bc-mobile-arrow" aria-hidden="true">↓</span>
          </button>
        </div>
        <div className="bc-panel">
          <div className="bc-panel-head">
            <label htmlFor={`${id}-output`} className="bc-label">{mode === 'uni2bijoy' ? 'Bijoy output' : 'Unicode output'}</label>
            <button type="button" className="bc-button bc-copy" disabled={!outputText} onClick={() => copy('output')} aria-label="Copy output text">
              {copied === 'output' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <textarea ref={outputRef} id={`${id}-output`} rows={10} value={outputText} readOnly spellCheck={false}
            placeholder="Converted output will appear here…" style={mode === 'uni2bijoy' ? bijoyStyle : unicodeStyle} className="bc-editor" />
        </div>
      </div>
      <div className="bc-footer">
        <p className="bc-font-note" role="status" aria-live="polite">
          {fontStatus === 'loading'
            ? 'Loading SutonnyMJ… Bijoy codes are shown until the font is ready.'
            : fontStatus === 'error'
              ? 'SutonnyMJ could not load. Showing raw Bijoy codes; conversion and copying still work. Check your connection and reload.'
              : rawBijoy
                ? 'Showing raw Bijoy codes. Turn off “Show raw Bijoy codes” to preview Bangla.'
                : 'SutonnyMJ preview loaded. Copied text has no font formatting; apply SutonnyMJ to the Bijoy Bangla in your design software.'}
        </p>
        <div className="bc-secondary-actions">
          <button type="button" className="bc-button" onClick={() => { resetStatus(); setInputText(''); setOutputText(''); inputRef.current?.focus() }}>Clear</button>
          <button type="button" className="bc-button" disabled={!inputText} onClick={() => convert(true)}>Convert selection</button>
        </div>
      </div>
      <p role="status" aria-live="polite" className="bc-status">{status}</p>
      {warnings.length > 0 && <details className="bc-notes" open>
        <summary>Review {warnings.length === 1 ? 'this conversion note' : `${warnings.length} conversion notes`}</summary>
        <ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      </details>}
    </section>
  )
}
