'use client'

import { useEffect, useId, useRef, useState } from 'react'

// Single-file React / Next.js component. No Tailwind or API key required.
// Unit references: https://www.nist.gov/pml/special-publication-811
// Currency API: https://frankfurter.dev/ (daily reference rates, not bank quotes).
type Unit = { id: string; name: string; factor: number; offset?: number; reciprocal?: boolean }
type Category = { id: string; name: string; units: Unit[]; note?: string }
const units = (rows: [string, string, number][]): Unit[] => rows.map(([id, name, factor]) => ({ id, name, factor }))
const FOOT = 0.3048, POUND = 0.45359237, GALLON = 0.003785411784, IMP_GALLON = 0.00454609
const LBF = POUND * 9.80665
const CATEGORIES: Category[] = [
  { id: 'length', name: 'Length', units: units([
    ['m','Metre (m)',1], ['km','Kilometre (km)',1000], ['cm','Centimetre (cm)',0.01], ['mm','Millimetre (mm)',0.001],
    ['um','Micrometre (µm)',1e-6], ['nm','Nanometre (nm)',1e-9], ['in','Inch (in)',0.0254], ['ft','Foot (ft)',FOOT],
    ['yd','Yard (yd)',0.9144], ['mi','Mile (mi)',1609.344], ['nmi','Nautical mile',1852], ['au','Astronomical unit',149597870700],
  ]) },
  { id: 'mass', name: 'Weight / mass', note: 'These are mass units. Use Force for newtons and pound-force.', units: units([
    ['kg','Kilogram (kg)',1], ['g','Gram (g)',0.001], ['mg','Milligram (mg)',1e-6], ['ug','Microgram (µg)',1e-9],
    ['t','Metric tonne (t)',1000], ['q','Metric quintal (100 kg)',100], ['lb','Pound (lb)',POUND], ['oz','Ounce (oz)',POUND/16],
    ['st','Stone (st)',POUND*14], ['ust','US short ton',POUND*2000], ['ukt','UK long ton',POUND*2240],
    ['ct','Metric carat (ct)',0.0002], ['ozt','Troy ounce (oz t)',0.0311034768], ['gr','Grain (gr)',POUND/7000],
  ]) },
  { id: 'temperature', name: 'Temperature', note: 'Absolute temperatures; values below absolute zero are rejected.', units: [
    { id:'c', name:'Celsius (°C)', factor:1, offset:273.15 }, { id:'f', name:'Fahrenheit (°F)', factor:5/9, offset:459.67*5/9 },
    { id:'k', name:'Kelvin (K)', factor:1 }, { id:'r', name:'Rankine (°R)', factor:5/9 },
  ] },
  { id:'temperature-change', name:'Temperature difference', note:'Temperature changes have no zero-point offset: a 1 °C change equals a 1.8 °F change.', units:units([
    ['dc','Celsius difference (Δ°C)',1], ['df','Fahrenheit difference (Δ°F)',5/9], ['dk','Kelvin difference (ΔK)',1], ['dr','Rankine difference (Δ°R)',5/9],
  ]) },
  { id:'area', name:'Area / land', note:'International foot and acre. Regional bigha/katha sizes vary and are not assumed.', units:units([
    ['m2','Square metre (m²)',1], ['km2','Square kilometre (km²)',1e6], ['cm2','Square centimetre (cm²)',1e-4], ['mm2','Square millimetre (mm²)',1e-6],
    ['ha','Hectare (ha)',10000], ['are','Are (a)',100], ['ft2','Square foot (ft²)',FOOT**2], ['in2','Square inch (in²)',0.0254**2],
    ['yd2','Square yard (yd²)',0.9144**2], ['acre','Acre (ac)',4046.8564224], ['decimal','Decimal / shotok (1/100 acre)',40.468564224], ['mi2','Square mile (mi²)',1609.344**2],
  ]) },
  { id:'volume', name:'Volume / cooking', note:'US, imperial and metric measures are separate. Cups and spoons use the definitions shown.', units:units([
    ['l','Litre (L)',0.001], ['ml','Millilitre (mL)',1e-6], ['m3','Cubic metre (m³)',1], ['cm3','Cubic centimetre (cm³)',1e-6],
    ['mm3','Cubic millimetre (mm³)',1e-9], ['ft3','Cubic foot (ft³)',FOOT**3], ['in3','Cubic inch (in³)',0.0254**3], ['yd3','Cubic yard (yd³)',0.9144**3],
    ['usgal','US liquid gallon',GALLON], ['impgal','Imperial gallon',IMP_GALLON], ['usqt','US liquid quart',GALLON/4], ['impqt','Imperial quart',IMP_GALLON/4],
    ['uspt','US liquid pint',GALLON/8], ['imppt','Imperial pint',IMP_GALLON/8], ['usfloz','US fluid ounce',GALLON/128], ['impfloz','Imperial fluid ounce',IMP_GALLON/160],
    ['uscup','US customary cup',GALLON/16], ['metriccup','Metric cup (250 mL)',0.00025], ['ustbsp','US tablespoon',GALLON/256], ['ustsp','US teaspoon',GALLON/768],
    ['mtbsp','Metric tablespoon (15 mL)',0.000015], ['mtsp','Metric teaspoon (5 mL)',0.000005], ['autbsp','Australian tablespoon (20 mL)',0.00002],
  ]) },
  { id:'time', name:'Time / duration', note:'Days are 24 hours; weeks are 7 days. Calendar months and years have variable lengths.', units:units([
    ['s','Second (s)',1], ['ms','Millisecond (ms)',0.001], ['us','Microsecond (µs)',1e-6], ['ns','Nanosecond (ns)',1e-9],
    ['min','Minute',60], ['h','Hour',3600], ['d','Day (24 hours)',86400], ['w','Week (7 days)',604800], ['jy','Julian year (365.25 days)',31557600],
  ]) },
  { id:'speed', name:'Speed', units:units([
    ['mps','Metre / second',1], ['kph','Kilometre / hour',1/3.6], ['mph','Mile / hour',1609.344/3600], ['fps','Foot / second',FOOT], ['kn','Knot',1852/3600], ['cms','Centimetre / second',0.01],
  ]) },
  { id:'acceleration', name:'Acceleration', units:units([
    ['mps2','Metre / second²',1], ['fps2','Foot / second²',FOOT], ['g0','Standard gravity (g₀)',9.80665], ['gal','Gal (cm/s²)',0.01],
  ]) },
  { id:'pressure', name:'Pressure', units:units([
    ['pa','Pascal (Pa)',1], ['kpa','Kilopascal (kPa)',1000], ['mpa','Megapascal (MPa)',1e6], ['hpa','Hectopascal (hPa)',100],
    ['bar','Bar',1e5], ['mbar','Millibar',100], ['atm','Standard atmosphere',101325], ['psi','Pound-force / square inch (psi)',LBF/0.0254**2],
    ['torr','Torr',101325/760], ['mmhg','Conventional mmHg',133.322387415],
  ]) },
  { id:'energy', name:'Energy', units:units([
    ['j','Joule (J)',1], ['kj','Kilojoule (kJ)',1000], ['mj','Megajoule (MJ)',1e6], ['wh','Watt-hour (Wh)',3600], ['kwh','Kilowatt-hour (kWh)',3.6e6],
    ['cal','Thermochemical calorie',4.184], ['kcal','Kilocalorie / food Calorie',4184], ['btu','BTU (international table)',1055.05585262],
    ['ev','Electronvolt (eV)',1.602176634e-19], ['ftlb','Foot-pound force',FOOT*LBF],
  ]) },
  { id:'power', name:'Power', units:units([
    ['w','Watt (W)',1], ['kw','Kilowatt (kW)',1000], ['mw','Megawatt (MW)',1e6], ['milliw','Milliwatt (mW)',0.001],
    ['hp','Mechanical horsepower',550*FOOT*LBF], ['ps','Metric horsepower',75*9.80665], ['btuh','BTU (IT) / hour',1055.05585262/3600],
  ]) },
  { id:'force', name:'Force', units:units([
    ['n','Newton (N)',1], ['kn','Kilonewton (kN)',1000], ['dyn','Dyne',1e-5], ['lbf','Pound-force (lbf)',LBF], ['kgf','Kilogram-force (kgf)',9.80665], ['ozf','Ounce-force',LBF/16],
  ]) },
  { id:'torque', name:'Torque', units:units([
    ['nm','Newton-metre (N·m)',1], ['ncm','Newton-centimetre',0.01], ['lbft','Pound-force foot',LBF*FOOT], ['lbin','Pound-force inch',LBF*0.0254], ['kgfm','Kilogram-force metre',9.80665],
  ]) },
  { id:'angle', name:'Angle', units:units([
    ['deg','Degree (°)',Math.PI/180], ['rad','Radian (rad)',1], ['grad','Gradian / gon',Math.PI/200], ['turn','Turn / revolution',2*Math.PI], ['amin','Arcminute (′)',Math.PI/10800], ['asec','Arcsecond (″)',Math.PI/648000],
  ]) },
  { id:'frequency', name:'Frequency', units:units([
    ['hz','Hertz (Hz)',1], ['khz','Kilohertz (kHz)',1000], ['mhz','Megahertz (MHz)',1e6], ['ghz','Gigahertz (GHz)',1e9], ['rpm','Revolutions / minute',1/60],
  ]) },
  { id:'data', name:'Digital storage', note:'Decimal kB/MB use powers of 1000. Binary KiB/MiB use powers of 1024. One byte = 8 bits.', units:units([
    ['b','Bit (b)',1], ['B','Byte (B)',8], ['kB','Kilobyte (kB)',8e3], ['MB','Megabyte (MB)',8e6], ['GB','Gigabyte (GB)',8e9], ['TB','Terabyte (TB)',8e12], ['PB','Petabyte (PB)',8e15],
    ['KiB','Kibibyte (KiB)',8*1024], ['MiB','Mebibyte (MiB)',8*1024**2], ['GiB','Gibibyte (GiB)',8*1024**3], ['TiB','Tebibyte (TiB)',8*1024**4], ['PiB','Pebibyte (PiB)',8*1024**5],
  ]) },
  { id:'data-rate', name:'Data transfer rate', units:units([
    ['bps','Bit / second (bit/s)',1], ['kbps','Kilobit / second',1e3], ['mbps','Megabit / second',1e6], ['gbps','Gigabit / second',1e9],
    ['Bs','Byte / second (B/s)',8], ['kBs','Kilobyte / second',8e3], ['MBs','Megabyte / second',8e6], ['GBs','Gigabyte / second',8e9], ['MiBs','Mebibyte / second',8*1024**2],
  ]) },
  { id:'fuel', name:'Fuel economy', note:'Consumption and economy are reciprocals. Enter a value greater than zero.', units:[
    {id:'l100',name:'Litres / 100 km',factor:1}, {id:'kml',name:'Kilometres / litre',factor:100,reciprocal:true},
    {id:'mpgus',name:'Miles / US gallon',factor:100*GALLON*1000/1.609344,reciprocal:true},
    {id:'mpgimp',name:'Miles / imperial gallon',factor:100*IMP_GALLON*1000/1.609344,reciprocal:true},
  ] },
  { id:'density', name:'Density', units:units([
    ['kgm3','Kilogram / cubic metre',1], ['gcm3','Gram / cubic centimetre',1000], ['kgL','Kilogram / litre',1000], ['gL','Gram / litre',1],
    ['lbft3','Pound / cubic foot',POUND/FOOT**3], ['lbusgal','Pound / US gallon',POUND/GALLON],
  ]) },
  { id:'flow', name:'Volume flow rate', units:units([
    ['m3s','Cubic metre / second',1], ['m3h','Cubic metre / hour',1/3600], ['Ls','Litre / second',0.001], ['Lmin','Litre / minute',0.001/60],
    ['Lh','Litre / hour',0.001/3600], ['usgpm','US gallons / minute',GALLON/60], ['impgpm','Imperial gallons / minute',IMP_GALLON/60], ['cfm','Cubic feet / minute',FOOT**3/60],
  ]) },
  { id:'voltage', name:'Voltage', units:units([['v','Volt (V)',1],['mv','Millivolt (mV)',0.001],['uv','Microvolt (µV)',1e-6],['kv','Kilovolt (kV)',1000]]) },
  { id:'current', name:'Electric current', units:units([['a','Ampere (A)',1],['ma','Milliampere (mA)',0.001],['ua','Microampere (µA)',1e-6],['ka','Kiloampere (kA)',1000]]) },
  { id:'resistance', name:'Electrical resistance', units:units([['ohm','Ohm (Ω)',1],['kohm','Kilohm (kΩ)',1000],['mohm','Megohm (MΩ)',1e6],['milliohm','Milliohm (mΩ)',0.001]]) },
  { id:'charge', name:'Electric charge', units:units([['c','Coulomb (C)',1],['mc','Millicoulomb',0.001],['ah','Ampere-hour (Ah)',3600],['mah','Milliampere-hour (mAh)',3.6]]) },
  { id:'capacitance', name:'Capacitance', units:units([['f','Farad (F)',1],['mf','Millifarad (mF)',0.001],['uf','Microfarad (µF)',1e-6],['nf','Nanofarad (nF)',1e-9],['pf','Picofarad (pF)',1e-12]]) },
  { id:'illuminance', name:'Illuminance', units:units([['lx','Lux (lx)',1],['fc','Foot-candle',1/FOOT**2],['phot','Phot',10000]]) },
  { id:'typography', name:'Typography / CSS', note:'CSS reference units: 96 px = 1 inch, 72 pt = 1 inch. Physical screen pixels depend on the device.', units:units([
    ['px','CSS pixel (px)',0.0254/96], ['pt','PostScript point (pt)',0.0254/72], ['pc','Pica (pc)',0.0254/6], ['mm','Millimetre (mm)',0.001], ['in','Inch (in)',0.0254],
  ]) },
]

function parseAmount(text: string): number | null {
  const normalized = text.trim().replace(/[০-৯]/g, ch => String(ch.charCodeAt(0)-0x09e6))
  if (!normalized) return null
  // Accept plain decimals / scientific notation. Reject partial numbers and ambiguous separators.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) throw new Error('Enter a number using a decimal point, without commas or spaces. Bengali digits are supported.')
  const value = Number(normalized)
  if (!Number.isFinite(value)) throw new Error('This number is too large.')
  if (value === 0 && /[1-9]/.test(normalized.split(/[eE]/)[0])) throw new Error('This number is too small to represent accurately.')
  return value
}
function convertUnit(value: number, category: Category, fromId: string, toId: string): number {
  const from = category.units.find(u => u.id === fromId), to = category.units.find(u => u.id === toId)
  if (!from || !to || !Number.isFinite(value)) throw new Error('Select valid units and enter a finite number.')
  if (category.id === 'fuel' && value <= 0) throw new Error('Fuel economy must be greater than zero.')
  let base = from.reciprocal ? from.factor / value : value * from.factor + (from.offset ?? 0)
  if (category.id === 'temperature') {
    // Check the input boundary before floating-point arithmetic.
    const minimum = from.id === 'c' ? -273.15 : from.id === 'f' ? -459.67 : 0
    if (value < minimum) throw new Error('Temperature cannot be below absolute zero.')
    if (value === minimum) base = 0
  }
  const result = from.id === to.id ? value : to.reciprocal ? to.factor / base : (base - (to.offset ?? 0)) / to.factor
  if (!Number.isFinite(base) || !Number.isFinite(result)) throw new Error('Result exceeds the supported numeric range.')
  if ((base === 0 || result === 0) && value !== 0 && !from.offset && !to.offset) throw new Error('Result is too small to represent accurately.')
  return Object.is(result, -0) ? 0 : result
}
function displayNumber(value: number, precision: number): string {
  return Number(value.toPrecision(precision)).toString()
}

type Currency = { iso_code: string; name: string }
type Rate = { base: string; quote: string; rate: number; date: string }
type SavedRate = { data: Rate; checked: number }
type RateState = { key: string; saved: SavedRate | null; loading: boolean; error: string; cached: boolean }
const API = 'https://api.frankfurter.dev/v2'
const FALLBACK_CURRENCIES: Currency[] = [
  ['USD','US Dollar'], ['BDT','Bangladeshi Taka'], ['EUR','Euro'], ['GBP','British Pound'], ['INR','Indian Rupee'],
  ['AUD','Australian Dollar'], ['CAD','Canadian Dollar'], ['JPY','Japanese Yen'], ['CNY','Chinese Yuan'],
  ['SAR','Saudi Riyal'], ['AED','UAE Dirham'], ['SGD','Singapore Dollar'], ['MYR','Malaysian Ringgit'], ['CHF','Swiss Franc'],
].map(([iso_code,name]) => ({iso_code,name}))
function validRate(value: unknown, base: string, quote: string): value is Rate {
  if (!value || typeof value !== 'object') return false
  const r = value as Rate
  if (r.base !== base || r.quote !== quote || typeof r.rate !== 'number' || !Number.isFinite(r.rate) || r.rate <= 0 || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false
  const time = Date.parse(r.date + 'T00:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === r.date && time <= Date.now()
}
async function fetchJSON(path: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once:true })
  if (signal.aborted) controller.abort()
  const timeout = setTimeout(cancel, 12000)
  try {
    const response = await fetch(`${API}${path}`, { signal:controller.signal, cache:'no-store' })
    if (!response.ok) throw new Error(`Rate service returned HTTP ${response.status}.`)
    return await response.json()
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel) }
}
function readCachedRate(base: string, quote: string): SavedRate | null {
  try {
    const value = JSON.parse(localStorage.getItem(`unit-fx-v1:${base}:${quote}`) ?? 'null') as SavedRate | null
    if (value && validRate(value.data,base,quote) && Number.isFinite(value.checked) && value.checked <= Date.now() && Date.now()-value.checked < 7*86400000) return value
  } catch { /* Storage may be disabled. Conversion still works online. */ }
  return null
}

// UI begins here.
const CSS = `
.uc-root,.uc-root *{box-sizing:border-box}.uc-root{max-width:1120px;margin:auto;padding:28px;border:1px solid #e2e8f0;border-radius:20px;background:#fff;color:#172b3a;font-family:Arial,sans-serif;color-scheme:light}
.uc-root h2{margin:0;font-size:26px;letter-spacing:-.6px}.uc-root p{line-height:1.6}.uc-root .uc-sub{color:#657587;font-size:14px;margin:8px 0 24px}.uc-root .uc-tabs{display:flex;gap:8px;padding:5px;background:#f1f5f9;border-radius:12px;width:fit-content;margin-bottom:24px}
.uc-root button{cursor:pointer;font:600 14px Arial,sans-serif;border:1px solid #d4dfe7;border-radius:9px;padding:11px 16px;color:#254253;background:#fff}.uc-root button:hover:not(:disabled){background:#edf5f5}.uc-root button:disabled{opacity:.5;cursor:not-allowed}.uc-root .uc-tabs button{border:0;background:transparent}.uc-root .uc-tabs button[aria-pressed=true]{background:#fff;color:#08776e;box-shadow:0 1px 5px #17394a18}
.uc-root label{display:block;font-size:13px;font-weight:700;margin-bottom:9px}.uc-root input,.uc-root select{width:100%;min-width:0;border:1px solid #cbd8e1;border-radius:9px;padding:12px;background:#fff;color:#172b3a;font:16px Arial,sans-serif}.uc-root input:focus-visible,.uc-root select:focus-visible,.uc-root button:focus-visible{outline:3px solid #88c9c1;outline-offset:2px}
.uc-root .uc-settings{display:grid;grid-template-columns:1fr 180px;gap:16px;margin-bottom:20px}.uc-root .uc-grid{display:grid;grid-template-columns:minmax(0,1fr) 60px minmax(0,1fr);align-items:center;gap:16px}.uc-root .uc-panel{background:#f8fafb;border:1px solid #e2e8f0;border-radius:14px;padding:20px;min-width:0}.uc-root .uc-panel select{margin-bottom:18px}.uc-root .uc-panel input{font-size:27px;font-weight:600;height:70px}.uc-root .uc-result{background:#eff9f6;border-color:#c9e6dc}.uc-root .uc-result input{background:transparent;border-color:#c0dfd5;color:#116958}
.uc-root .uc-swap{padding:12px 0;font-size:23px}.uc-root .uc-actions{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:18px;flex-wrap:wrap}.uc-root .uc-note{font-size:13px;color:#637786;margin:14px 0 0}.uc-root .uc-error{background:#fff2ef;color:#a63622;border:1px solid #f2cec5;padding:12px;border-radius:9px;font-size:14px}.uc-root .uc-meta{background:#f6f8fa;border-radius:10px;padding:14px;margin-top:20px;font-size:13px;line-height:1.8;overflow-wrap:anywhere}.uc-root .uc-meta p{margin:0}.uc-root a{color:#08776e}.uc-root .uc-footer{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px;display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}.uc-root .uc-footer p{margin:0;font-size:12px;color:#657587}.uc-root .uc-copy-status{font-size:13px;color:#405c6c;min-height:20px;margin:10px 0 0}.uc-root .uc-title-row{display:flex;align-items:center;justify-content:space-between;gap:16px}.uc-root .uc-badge{font-size:11px;background:#eef7f5;border-radius:20px;color:#247362;padding:8px 11px;white-space:nowrap}
@media(max-width:650px){.uc-root{padding:18px}.uc-root h2{font-size:22px}.uc-root .uc-grid{grid-template-columns:minmax(0,1fr);gap:12px}.uc-root .uc-swap{width:60px;justify-self:center;transform:rotate(90deg)}.uc-root .uc-settings{grid-template-columns:minmax(0,1fr)}.uc-root .uc-badge{display:none}.uc-root .uc-panel{padding:16px}.uc-root .uc-panel input{font-size:23px}}
`

export default function UniversalConverter() {
  const id = useId()
  const [mode,setMode] = useState<'unit'|'currency'>('unit')
  const [categoryId,setCategoryId] = useState('length')
  const [unitFrom,setUnitFrom] = useState('m'), [unitTo,setUnitTo] = useState('km')
  const [currencyFrom,setCurrencyFrom] = useState('USD'), [currencyTo,setCurrencyTo] = useState('BDT')
  const [amount,setAmount] = useState('1'), [precision,setPrecision] = useState(12)
  const [currencies,setCurrencies] = useState<Currency[]>(FALLBACK_CURRENCIES)
  const [catalogError,setCatalogError] = useState(''), [catalogLoading,setCatalogLoading] = useState(false)
  const [refresh,setRefresh] = useState(0)
  const [rateState,setRateState] = useState<RateState>({key:'',saved:null,loading:false,error:'',cached:false})
  const [copyStatus,setCopyStatus] = useState('')
  const resultRef = useRef<HTMLInputElement>(null), copyRequest = useRef(0)
  const lastRefresh = useRef(0)
  const category = CATEGORIES.find(c => c.id === categoryId)!
  const pairKey = `${currencyFrom}:${currencyTo}`
  const sameCurrency = currencyFrom === currencyTo
  const rate = rateState.key === pairKey ? rateState.saved : null
  const rateLoading = mode === 'currency' && !sameCurrency && (rateState.key !== pairKey || rateState.loading)
  const rateError = rateState.key === pairKey ? rateState.error : ''
  const options = mode === 'unit' ? category.units.map(u => ({id:u.id,name:u.name})) : currencies.map(c => ({id:c.iso_code,name:`${c.iso_code} — ${c.name}`}))
  const from = mode === 'unit' ? unitFrom : currencyFrom, to = mode === 'unit' ? unitTo : currencyTo

  // Fetch on entry, hourly while visible, on return to the tab, and on reconnect.
  useEffect(() => {
    if (mode !== 'currency') return
    const request = () => {
      if (document.visibilityState === 'visible' && Date.now()-lastRefresh.current >= 5*60000) {
        lastRefresh.current = Date.now(); setRefresh(n => n+1)
      }
    }
    const online = () => { lastRefresh.current=Date.now(); setRefresh(n => n+1) }
    const interval = setInterval(request,60*60000)
    window.addEventListener('focus',request); window.addEventListener('online',online); document.addEventListener('visibilitychange',request)
    return () => { clearInterval(interval); window.removeEventListener('focus',request); window.removeEventListener('online',online); document.removeEventListener('visibilitychange',request) }
  },[mode])

  useEffect(() => {
    if (mode !== 'currency') return
    const controller = new AbortController()
    setCatalogLoading(true); setCatalogError('')
    void fetchJSON('/currencies',controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (!Array.isArray(value)) throw new Error('Invalid currency list')
      const list: Currency[] = value.filter((c): c is Currency => !!c && typeof c.iso_code === 'string' && /^[A-Z]{3}$/.test(c.iso_code) && typeof c.name === 'string')
      if (!list.length) throw new Error('Empty currency list')
      // Retain fallback options if a temporary catalogue response omits them; missing pairs report an error.
      const merged = new Map(FALLBACK_CURRENCIES.map(c => [c.iso_code,c]))
      list.forEach(c => merged.set(c.iso_code,c))
      setCurrencies([...merged.values()].sort((a,b) => a.iso_code.localeCompare(b.iso_code)))
    }).catch(() => { if (!controller.signal.aborted) setCatalogError('Could not refresh the full currency list. Showing the available list; retry with Refresh rates.') })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => controller.abort()
  },[mode,refresh])

  useEffect(() => {
    if (mode !== 'currency' || sameCurrency) return
    const controller = new AbortController()
    const cached = readCachedRate(currencyFrom,currencyTo)
    setRateState({key:pairKey,saved:cached,loading:true,error:'',cached:!!cached})
    lastRefresh.current = Date.now()
    void fetchJSON(`/rate/${currencyFrom}/${currencyTo}`,controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (!validRate(value,currencyFrom,currencyTo)) throw new Error('Invalid exchange-rate response.')
      const saved: SavedRate = {data:value,checked:Date.now()}
      try { localStorage.setItem(`unit-fx-v1:${pairKey}`,JSON.stringify(saved)) } catch { /* Optional cache only. */ }
      setRateState({key:pairKey,saved,loading:false,error:'',cached:false})
    }).catch(() => {
      if (!controller.signal.aborted) setRateState({key:pairKey,saved:cached,loading:false,error:cached
        ? 'Refresh failed. This result uses a previously saved rate; check its date before using it.'
        : 'No rate available. Check your connection or try another currency pair, then refresh.',cached:!!cached})
    })
    return () => controller.abort()
  },[mode,currencyFrom,currencyTo,pairKey,sameCurrency,refresh])

  let result: number | null = null, inputError = '', numericAmount: number | null = null
  try {
    numericAmount = parseAmount(amount)
    if (numericAmount !== null) {
      if (mode === 'unit') result = convertUnit(numericAmount,category,from,to)
      else if (sameCurrency) result = numericAmount
      else if (rate) {
        result = numericAmount*rate.data.rate
        if (!Number.isFinite(result)) throw new Error('Result exceeds the supported numeric range.')
        if (result === 0 && numericAmount !== 0) throw new Error('Result is too small to represent accurately.')
      }
    }
  } catch(error) { inputError = error instanceof Error ? error.message : 'Invalid input.'; result = null }
  const resultText = result === null ? '' : displayNumber(result,precision)
  useEffect(() => { copyRequest.current++; setCopyStatus('') },[resultText,amount,mode,from,to,precision])
  useEffect(() => () => { copyRequest.current++ },[])
  const copy = async () => {
    if (result === null) return
    const request = ++copyRequest.current
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(resultText)
      if (request === copyRequest.current) setCopyStatus('Result copied.')
    } catch {
      if (request !== copyRequest.current) return
      resultRef.current?.focus(); resultRef.current?.select()
      setCopyStatus('Result selected. Press Ctrl+C or Command+C to copy.')
    }
  }
  const swap = () => {
    // Keep the entered amount, and reverse the selected units/currencies.
    if (mode === 'unit') { setUnitFrom(unitTo); setUnitTo(unitFrom) }
    else { setCurrencyFrom(currencyTo); setCurrencyTo(currencyFrom) }
  }
  return (
    <section className="uc-root" aria-labelledby={`${id}-title`}>
      <style>{CSS}</style>
      <header>
        <div className="uc-title-row"><h2 id={`${id}-title`}>Unit &amp; Currency Converter</h2><span className="uc-badge">Everyday calculations, simplified</span></div>
        <p className="uc-sub">Convert measurements instantly, or check the latest available exchange rates.</p>
      </header>
      <div className="uc-tabs" role="group" aria-label="Converter type">
        <button type="button" aria-pressed={mode==='unit'} onClick={() => setMode('unit')}>Unit converter</button>
        <button type="button" aria-pressed={mode==='currency'} onClick={() => setMode('currency')}>Currency converter</button>
      </div>
      <div className="uc-settings">
        <div>{mode === 'unit' ? <><label htmlFor={`${id}-category`}>Measurement category</label>
          <select id={`${id}-category`} value={categoryId} onChange={e => {
            const next = CATEGORIES.find(c => c.id === e.target.value)!
            setCategoryId(next.id); setUnitFrom(next.units[0].id); setUnitTo(next.units[1].id)
          }}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></>
          : <><label htmlFor={`${id}-currency-info`}>Exchange rates</label><p id={`${id}-currency-info`} className="uc-note">{catalogLoading ? 'Updating currency list…' : `${currencies.length} currencies in the list`}. Default: USD → BDT.</p></>}
        </div>
        <div><label htmlFor={`${id}-precision`}>Significant digits</label><select id={`${id}-precision`} value={precision} onChange={e => setPrecision(Number(e.target.value))}>
          {[6,10,12,15].map(n => <option key={n} value={n}>{n} digits</option>)}
        </select></div>
      </div>
      <div className="uc-grid">
        <div className="uc-panel">
          <label htmlFor={`${id}-from`}>From</label>
          <select id={`${id}-from`} value={from} onChange={e => mode==='unit' ? setUnitFrom(e.target.value) : setCurrencyFrom(e.target.value)}>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label htmlFor={`${id}-amount`}>Amount</label>
          <input id={`${id}-amount`} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={amount} placeholder="Enter a number"
            aria-invalid={!!inputError} aria-describedby={inputError ? `${id}-error` : undefined} onChange={e => setAmount(e.target.value)} />
        </div>
        <button type="button" className="uc-swap" onClick={swap} aria-label="Swap source and target" title="Swap source and target">⇄</button>
        <div className="uc-panel uc-result" aria-busy={rateLoading}>
          <label htmlFor={`${id}-to`}>To</label>
          <select id={`${id}-to`} value={to} onChange={e => mode==='unit' ? setUnitTo(e.target.value) : setCurrencyTo(e.target.value)}>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label htmlFor={`${id}-result`}>Converted result{mode==='currency' && !sameCurrency && rateState.key===pairKey && rateState.cached ? ' (cached)' : ''}</label>
          <input ref={resultRef} id={`${id}-result`} readOnly value={resultText} placeholder={rateLoading ? 'Fetching rate…' : '—'} aria-describedby={`${id}-notes`} />
        </div>
      </div>
      <div className="uc-actions">
        <button type="button" onClick={() => setAmount('')}>Clear</button>
        <div><button type="button" disabled={result===null} onClick={copy}>Copy result</button></div>
      </div>
      {inputError && <p id={`${id}-error`} role="alert" className="uc-error">{inputError}</p>}
      <div id={`${id}-notes`}>
        {mode==='unit' ? <p className="uc-note">{category.note ?? 'Conversion updates automatically as you type.'} Results are rounded to the selected significant digits.</p> : <div className="uc-meta" aria-live="polite">
          {sameCurrency ? <p>Same currency: 1 {currencyFrom} = 1 {currencyTo}. No exchange rate is needed.</p> : <>
            {rate && <><p><strong>1 {currencyFrom} ≈ {displayNumber(rate.data.rate,12)} {currencyTo}</strong></p>
              <p>Rate date: <strong>{rate.data.date}</strong>{rateState.cached ? ' · Saved rate' : ' · Latest response from provider'}</p>
              <p>Last successful check: {new Date(rate.checked).toLocaleString()}</p>
              {Date.now()-Date.parse(rate.data.date+'T00:00:00Z') > 7*86400000 && <p><strong>This rate is more than 7 days old.</strong></p>}
            </>}
            {rateLoading && <p>Checking the latest available rate…</p>}
            {rateError && <p role="alert">{rateError}</p>}
          </>}
          {catalogError && <p role="alert">{catalogError}</p>}
          <p>Daily reference rates from <a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">Frankfurter</a>. Source dates can lag on weekends and holidays. Bank rates, fees and spreads may differ.</p>
          <p>Automatically checks on opening, hourly while visible, when returning to the page after five minutes, and on reconnect.</p>
        </div>}
      </div>
      <p className="uc-copy-status" role="status">{copyStatus}</p>
      <footer className="uc-footer">
        <p>{mode==='unit' ? `${CATEGORIES.length} categories · ${CATEGORIES.reduce((n,c)=>n+c.units.length,0)} unit choices · Unit conversion works offline once loaded` : 'Internet is needed for new rates. Saved fallback rates are always labelled.'}</p>
        {mode==='currency' && <button type="button" disabled={rateLoading || catalogLoading} onClick={() => {lastRefresh.current=Date.now();setRefresh(n=>n+1)}}>Refresh rates</button>}
      </footer>
    </section>
  )
}
