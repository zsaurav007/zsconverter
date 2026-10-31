'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Download, Layers, Upload, X } from 'lucide-react'
import { canvasBlob, canvasFromBlob, composite, context, illustratorPackage, loadImage, makeCanvas, rasterSvg, saveBlob, splitByMask, vectorSvg } from './aiArtwork'
import type { PixelLayer, VectorArtwork, VectorLayer } from './aiArtwork'

type Mode = 'vector' | 'photo'
type Point = { x: number; y: number }
const errorText = (e: unknown) => e instanceof Error ? e.message : 'The operation could not be completed.'
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-40 hover:bg-slate-100'
const control = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'

export default function AiConverter() {
  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState<HTMLCanvasElement | null>(null)
  const [pixels, setPixels] = useState<PixelLayer[]>([])
  const [art, setArt] = useState<VectorArtwork | null>(null)
  const [mode, setMode] = useState<Mode>('vector')
  const [format, setFormat] = useState('illustrator')
  const [colors, setColors] = useState(16)
  const [detail, setDetail] = useState(0.5)
  const [traceSize, setTraceSize] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [points, setPoints] = useState<Point[]>([])
  const [downloadSize, setDownloadSize] = useState<number | null>(null)
  const worker = useRef<Worker | null>(null)
  const workerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const job = useRef(0)
  const alive = useRef(true)
  const stopWorker = () => { worker.current?.terminate(); worker.current = null; if (workerTimer.current) clearTimeout(workerTimer.current); workerTimer.current = null }
  useEffect(() => { alive.current = true; return () => { alive.current = false; job.current++; stopWorker() } }, [])
  const isCurrent = (id: number) => alive.current && job.current === id
  const cancel = () => { job.current++; stopWorker(); setBusy(''); setNotice('Cancelled. No output was downloaded.') }
  const reset = () => { cancel(); setFile(null); setSource(null); setPixels([]); setArt(null); setError(''); setNotice(''); setPoints([]); setSelecting(false); setDownloadSize(null) }

  const onDrop = useCallback(async (files: File[]) => {
    if (!files[0]) return
    const input = files[0], id = ++job.current
    stopWorker()
    setBusy('Opening image…'); setError(''); setNotice(''); setArt(null); setSource(null); setPixels([]); setFile(null); setSelecting(false); setPoints([]); setDownloadSize(null)
    try {
      if (input.size > 40 * 1024 * 1024) throw new Error('Use an image smaller than 40 MB.')
      if (!/\.(png|jpe?g|webp|svg)$/i.test(input.name)) throw new Error('Choose PNG, JPEG, WebP or SVG. AI, EPS and PDF inputs are not supported in this image converter.')
      if (/\.svg$/i.test(input.name)) {
        const text = await input.text(), doc = new DOMParser().parseFromString(text, 'image/svg+xml')
        if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Invalid SVG file.')
        if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text) || doc.querySelector('script,foreignObject,style,animate,animateTransform,animateMotion,set')) throw new Error('Use a static SVG without scripts, stylesheets or animation, or export it as PNG first.')
        for (const el of Array.from(doc.querySelectorAll('*'))) for (const attr of Array.from(el.attributes)) {
          if (/^on/i.test(attr.name) || /url\s*\(/i.test(attr.value) && !/^url\(\s*#[^)]*\)$/i.test(attr.value)) throw new Error('Use an SVG without external resources, or export it as PNG first.')
          if (/href$/i.test(attr.name) && !/^(#|data:image\/(png|jpeg|webp);base64,)/i.test(attr.value)) throw new Error('SVG linked resources are unsupported. Embed them or export a PNG.')
        }
      }
      const decoded = await canvasFromBlob(input)
      if (!isCurrent(id)) return
      setFile(input); setSource(decoded); setPixels([{ id: 'remainder', name: 'Remaining image', visible: true, canvas: decoded }]); setTraceSize(0)
      if (/\.svg$/i.test(input.name)) setNotice('SVG input is rasterized for image processing. Keep the original SVG to preserve its existing paths.')
    } catch (e) { if (isCurrent(id)) setError(errorText(e)) }
    finally { if (isCurrent(id)) setBusy('') }
  }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, disabled: !!busy, multiple: false, maxFiles: 1, maxSize: 40 * 1024 * 1024,
    accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/svg+xml': ['.svg'] },
    onDropRejected: () => setError('Choose one PNG, JPEG, WebP or static SVG image, up to 40 MB.'),
  })
  useEffect(() => {
    let disposed = false, url = ''
    setPreview('')
    if (!source) return
    const build = async () => {
      const blob = showOriginal ? await canvasBlob(source)
        : mode === 'vector' && art ? new Blob([vectorSvg(art)], { type: 'image/svg+xml' })
        : await canvasBlob(mode === 'photo' ? composite(pixels, source.width, source.height) : source)
      if (disposed) return
      url = URL.createObjectURL(blob); setPreview(url)
    }
    void build().catch(e => { if (!disposed) setError(errorText(e)) })
    return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
  }, [source, art, pixels, mode, showOriginal])
  useEffect(() => { setDownloadSize(null) }, [art, pixels, format, mode, source])

  const trace = () => {
    if (!source || busy) return
    const id = ++job.current
    setError(''); setNotice(''); setBusy('Tracing colours…'); setShowOriginal(false)
    try {
      const scale = traceSize ? Math.min(1, traceSize / Math.max(source.width, source.height)) : 1
      const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale))
      if (width * height > 2_000_000) throw new Error('Original exceeds the 2-megapixel trace limit. Choose 1400 px or 1000 px explicitly, or use full-resolution photo layers.')
      const canvas = makeCanvas(width, height); context(canvas).drawImage(source, 0, 0, width, height)
      const data = context(canvas).getImageData(0, 0, width, height)
      const instance = new Worker(new URL('./aiTrace.worker.ts', import.meta.url), { type: 'module' }); worker.current = instance
      workerTimer.current = setTimeout(() => { if (isCurrent(id)) { stopWorker(); setBusy(''); setError('Tracing exceeded 90 seconds. Reduce colours or trace size and retry.') } }, 90_000)
      instance.onmessage = (event: MessageEvent<{ ok: boolean; layers: VectorLayer[]; segments: number; error?: string }>) => {
        if (!isCurrent(id)) { instance.terminate(); return }
        stopWorker()
        setBusy('')
        if (!event.data.ok) { setError(event.data.error || 'Tracing failed.'); return }
        const sx = source.width / width, sy = source.height / height
        setArt({ width: source.width, height: source.height, segments: event.data.segments, layers: event.data.layers.map(l => ({ ...l, body: `<g transform="scale(${sx} ${sy})">${l.body}</g>` })) })
        setNotice(`Created ${event.data.layers.length} colour layers from ${width} × ${height} pixels. Tracing is approximate; compare with Original before export.`)
      }
      instance.onerror = () => { if (isCurrent(id)) { stopWorker(); setBusy(''); setError('Trace worker failed. Check worker bundling and browser memory, then retry.') } }
      instance.postMessage({ width, height, buffer: data.data.buffer, colors, detail }, [data.data.buffer])
    } catch (e) { stopWorker(); setError(errorText(e)); setBusy('') }
  }
  const appendSelection = (mask: HTMLCanvasElement, name: string) => {
    if (pixels.length >= 12) throw new Error('Up to 12 photo layers are supported.')
    if (!source || source.width * source.height * (pixels.length + 3) > 48_000_000) throw new Error('Layer memory limit reached. Use a smaller source to add more layers.')
    const remaining = pixels[0], split = splitByMask(remaining.canvas, mask)
    setPixels([{ ...remaining, canvas: split.remainder }, ...pixels.slice(1), { id: `object-${Date.now()}`, name, visible: true, canvas: split.subject }])
    setNotice('Selected pixels moved to their own layer. Background holes are transparent, not reconstructed.'); setDownloadSize(null)
  }
  const finishSelection = () => {
    if (!source || points.length < 3) return
    try {
      const mask = makeCanvas(source.width, source.height), ctx = context(mask)
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill()
      appendSelection(mask, `Object ${pixels.length}`); setSelecting(false); setPoints([]); setError('')
    } catch (e) { setError(errorText(e)) }
  }
  const autoSubject = async () => {
    if (!source || busy) return
    const id = ++job.current
    setBusy('Loading subject detector…'); setError(''); setNotice(''); setShowOriginal(false)
    try {
      const remaining = pixels[0].canvas, blob = await canvasBlob(remaining)
      const { removeBackground } = await import('@imgly/background-removal')
      if (!isCurrent(id)) return
      const foreground = await removeBackground(blob, {
        model: 'isnet_fp16', output: { format: 'image/png', quality: 1 },
        progress: (key, current, total) => { if (isCurrent(id)) setBusy(key.startsWith('fetch:') && total > 0 ? `Downloading model… ${Math.round(current / total * 100)}%` : 'Detecting subject…') },
      })
      if (!isCurrent(id)) return
      const image = await loadImage(foreground)
      if (!isCurrent(id)) return
      const mask = makeCanvas(source.width, source.height); context(mask).drawImage(image, 0, 0, mask.width, mask.height)
      // IMG.LY 1.7 writes the predicted mask into output alpha (it does not
      // multiply by source alpha). Keep that mask; splitByMask preserves source RGBA.
      appendSelection(mask, `Subject ${pixels.length}`)
    } catch (e) { if (isCurrent(id)) setError(`Subject detection failed: ${errorText(e)} Manual selection is available.`) }
    finally { if (isCurrent(id)) setBusy('') }
  }
  const exportArtwork = async () => {
    if (!source || !file || busy) return
    if (mode === 'vector' && !art) { setError('Create vector layers first.'); return }
    const id = ++job.current
    setBusy('Preparing download…'); setError(''); setDownloadSize(null)
    try {
      const vector = mode === 'vector' ? art : null, width = source.width, height = source.height
      let blob: Blob, ext = format
      if (format === 'illustrator') { blob = await illustratorPackage(vector, pixels, width, height); ext = 'zip' }
      else if (format === 'svg') blob = new Blob([vector ? vectorSvg(vector) : rasterSvg(pixels, width, height)], { type: 'image/svg+xml' })
      else {
        const raster = vector ? await canvasFromBlob(new Blob([vectorSvg(vector)], { type: 'image/svg+xml' })) : composite(pixels, width, height)
        if (!isCurrent(id)) return
        if (format === 'psd') {
          if (vector) throw new Error('Use the Illustrator package to retain vector paths. PSD export is for photo layers.')
          const { writePsd } = await import('ag-psd')
          blob = new Blob([writePsd({ width, height, canvas: raster, children: pixels.map(l => ({ name: l.name, canvas: l.canvas, hidden: !l.visible })) })], { type: 'image/vnd.adobe.photoshop' })
        } else if (format === 'jpg') {
          const white = makeCanvas(width, height), ctx = context(white); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(raster, 0, 0)
          blob = await canvasBlob(white, 'image/jpeg')
        } else if (format === 'tiff') {
          const { encodeImage } = await import('utif'), rgba = context(raster).getImageData(0, 0, width, height).data
          blob = new Blob([encodeImage(new Uint8Array(rgba.buffer), width, height)], { type: 'image/tiff' })
        } else blob = await canvasBlob(raster)
      }
      if (!isCurrent(id)) return
      saveBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}-${mode}-layers.${ext}`); setDownloadSize(blob.size)
    } catch (e) { if (isCurrent(id)) setError(errorText(e)) }
    finally { if (isCurrent(id)) setBusy('') }
  }
  const layers = mode === 'vector' ? art?.layers || [] : pixels
  const renameOrToggle = (id: string, patch: { name?: string; visible?: boolean }) => {
    if (mode === 'vector') setArt(a => a ? { ...a, layers: a.layers.map(l => l.id === id ? { ...l, ...patch } : l) } : a)
    else setPixels(ls => ls.map(l => l.id === id ? { ...l, ...patch } : l))
  }
  const switchMode = (next: Mode) => { setMode(next); setSelecting(false); setPoints([]); setError(''); setFormat('illustrator'); setShowOriginal(false); setNotice('') }
  return <div className="flex min-h-[650px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:flex-row">
    <aside className="flex w-full flex-col gap-4 bg-slate-50 p-5 lg:w-80 lg:shrink-0 lg:border-r lg:border-slate-200">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800"><Layers size={18} /> Image to Illustrator</h2>
      <fieldset disabled={!!busy} className="grid grid-cols-2 gap-2"><legend className="mb-2 text-sm font-medium">Create layers</legend>{(['vector', 'photo'] as const).map(m => <label key={m} className={`cursor-pointer rounded-lg border p-3 text-sm ${mode === m ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'}`}><input className="mr-2" type="radio" name="ai-mode" checked={mode === m} onChange={() => switchMode(m)} />{m === 'vector' ? 'Vector colours' : 'Photo objects'}</label>)}</fieldset>
      <p className="text-xs leading-relaxed text-slate-600">{mode === 'vector' ? 'Logos → editable paths grouped by colour. Tracing changes edges and colours; text becomes outlines.' : 'Photos → separate pixel layers. Select objects manually or detect the foreground. Background holes stay transparent.'}</p>
      {source && <>
        {mode === 'vector' ? <fieldset disabled={!!busy} className="space-y-3">
          <label className="block text-sm">Colours<select aria-label="Colours" className={control} value={colors} onChange={e => { setColors(Number(e.target.value)); setArt(null) }}>{[4, 8, 16, 24, 32].map(n => <option key={n} value={n}>{n} colours</option>)}</select></label>
          <label className="block text-sm">Detail<select aria-label="Detail" className={control} value={detail} onChange={e => { setDetail(Number(e.target.value)); setArt(null) }}><option value={0.25}>Fine edges</option><option value={0.5}>Balanced</option><option value={1}>Simpler paths</option></select></label>
          <label className="block text-sm">Trace resolution<select aria-label="Trace resolution" className={control} value={traceSize} onChange={e => { setTraceSize(Number(e.target.value)); setArt(null) }}><option value={0}>Original pixels</option><option value={1400}>Up to 1400 px — less detail</option><option value={1000}>Up to 1000 px — less detail</option></select></label>
          <button className={`${button} w-full`} onClick={trace}>Create vector layers</button>
        </fieldset> : <div className="space-y-2">
          <button className={`${button} w-full`} disabled={!!busy || selecting} onClick={autoSubject}>Detect subject</button><p className="text-xs text-slate-500">First use downloads an AI model. Processing is local. Review detected edges.</p>
          <button className={`${button} w-full`} disabled={!!busy} onClick={() => { setSelecting(s => !s); setPoints([]); setShowOriginal(false) }}>{selecting ? 'Cancel selection' : 'Select object manually'}</button>
          {selecting && <><p className="text-xs text-slate-600">Click around an object, then finish. Only remaining pixels are moved.</p><div className="flex gap-2"><button className={button} disabled={!points.length} onClick={() => setPoints(p => p.slice(0, -1))}>Undo point</button><button className={button} disabled={points.length < 3} onClick={finishSelection}>Finish selection</button></div></>}
          {pixels.length > 1 && <button className={`${button} w-full`} disabled={!!busy} onClick={() => { setPixels([{ id: 'remainder', name: 'Remaining image', visible: true, canvas: source }]); setNotice('Selections reset.'); setSelecting(false); setPoints([]) }}>Reset photo layers</button>}
        </div>}
        {!!layers.length && <fieldset disabled={!!busy} className="space-y-2"><legend className="mb-2 text-sm font-semibold">Layers ({layers.length})</legend><div className="max-h-56 space-y-2 overflow-auto">{[...layers].reverse().map(l => <div key={l.id} className="flex items-center gap-2"><input type="checkbox" checked={l.visible} aria-label={`Show ${l.name}`} onChange={e => renameOrToggle(l.id, { visible: e.target.checked })} /><input className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-sm" value={l.name} maxLength={80} aria-label="Layer name" onChange={e => renameOrToggle(l.id, { name: e.target.value })} /></div>)}</div></fieldset>}
        <label className="text-sm font-medium">Export<select aria-label="Export" className={`${control} mt-1`} value={format} disabled={!!busy} onChange={e => setFormat(e.target.value)}><option value="illustrator">Illustrator layers package (.zip)</option><option value="svg">{mode === 'vector' ? 'SVG — editable vector groups' : 'SVG — embedded image groups'}</option>{mode === 'photo' && <option value="psd">PSD — named pixel layers</option>}<option value="png">PNG — flattened, transparent</option><option value="jpg">JPEG — flattened, white background</option><option value="tiff">TIFF — flattened, uncompressed</option></select></label>
        {format === 'illustrator' && <p className="text-xs leading-relaxed text-slate-600">Extract ZIP → Illustrator → File → Scripts → Other Script. Run the included JSX to create named layers and save .ai. Requires desktop Illustrator; no credentials requested here.</p>}
        <button className="flex items-center justify-center gap-2 rounded-lg bg-[#6384A3] px-4 py-3 font-semibold text-white disabled:opacity-40" disabled={!!busy || selecting || mode === 'vector' && !art} onClick={exportArtwork}><Download size={17} /> Export layers</button>
        {downloadSize !== null && <p className="text-xs text-slate-600">Downloaded: {downloadSize.toLocaleString()} bytes</p>}
      </>}
    </aside>
    <main className="flex min-w-0 flex-1 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600"><span className="break-all">{file ? `${file.name} · ${source?.width} × ${source?.height}` : 'Start with an image'}</span>{file && <div className="flex gap-2"><button className={button} disabled={selecting || !!busy} onClick={() => setShowOriginal(v => !v)}>{showOriginal ? 'Show layers' : 'Original'}</button><button className={button} onClick={reset} aria-label="Remove image"><X size={16} /></button></div>}</div>
      {busy && <div role="status" className="flex items-center justify-between rounded-lg bg-blue-50 p-3 text-sm"><span>{busy}</span><button className={button} onClick={cancel}>Cancel</button></div>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-slate-100 p-3 text-xs leading-relaxed text-slate-600">{notice}</p>}
      {!source ? <div {...getRootProps()} className={`flex min-h-80 flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300'}`}><input {...getInputProps()} /><Upload className="mb-4 text-slate-400" size={36} /><p className="font-medium text-slate-700">Drop an image or click to browse</p><p className="mt-2 text-sm text-slate-500">PNG, JPEG, WebP or static SVG · up to 40 MB / 12 MP</p></div> : <div className="flex min-h-80 flex-1 items-center justify-center overflow-auto rounded-lg border border-slate-200 p-3" style={{ backgroundColor: '#fff', backgroundImage: 'conic-gradient(#edf0f4 25%,transparent 0 50%,#edf0f4 0 75%,transparent 0)', backgroundSize: '20px 20px' }}>
        {preview && <div className="relative" style={{ width: '100%', maxWidth: source.width, aspectRatio: `${source.width}/${source.height}` }}><img src={preview} alt={showOriginal ? 'Original image' : 'Layer artwork preview'} className="block h-full w-full" />{selecting && <svg data-testid="selection-overlay" className="absolute inset-0 h-full w-full cursor-crosshair" viewBox={`0 0 ${source.width} ${source.height}`} preserveAspectRatio="none" onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setPoints(p => [...p, { x: (e.clientX - rect.left) * source.width / rect.width, y: (e.clientY - rect.top) * source.height / rect.height }]) }}><polygon points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="rgba(59,130,246,0.2)" stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" />{points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={Math.max(source.width, source.height) / 180} fill="#2563eb" />)}</svg>}</div>}
      </div>}
    </main>
  </div>
}
