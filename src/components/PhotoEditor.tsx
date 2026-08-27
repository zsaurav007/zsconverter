'use client'

import { useState, useRef } from 'react'
import ReactCrop, { Crop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { removeBackground, Config } from '@imgly/background-removal'
import { jsPDF } from 'jspdf'
import { Crop as CropIcon, Eraser, Download, Settings2, Image as ImageIcon, Palette, Type, X, Undo2, Sparkles, Wand2, RotateCw, FlipHorizontal, FlipVertical, Square } from 'lucide-react'
import CustomDropdown from './CustomDropdown'

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.setAttribute('crossOrigin', 'anonymous')
    image.src = url
  })

const optimizeImageForAI = async (imageSrc: string): Promise<string> => {
  const img = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return imageSrc

  const MAX_DIM = 1200
  let width = img.width
  let height = img.height
  if (width > MAX_DIM || height > MAX_DIM) {
    if (width > height) { height = Math.round((height * MAX_DIM) / width); width = MAX_DIM } 
    else { width = Math.round((width * MAX_DIM) / height); height = MAX_DIM }
  }

  canvas.width = width
  canvas.height = height
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.95) 
}

interface PhotoEditorProps {
  file: File
  onCancel: () => void
  onComplete: (finalImageUrl: string) => void
}

export default function PhotoEditor({ file, onCancel, onComplete }: PhotoEditorProps) {
  const initialImage = URL.createObjectURL(file)
  const [history, setHistory] = useState<string[]>([initialImage])
  const currentImage = history[history.length - 1] 
  const canUndo = history.length > 1
  
  const [activeTool, setActiveTool] = useState<'crop' | 'bg' | 'enhance' | 'transform' | null>(null)
  
  // Base Name for Exporting
  const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name

  // Transform State
  const [liveTransform, setLiveTransform] = useState({ rotate: 0, flipH: false, flipV: false, radius: 0 })

  // Crop State
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 100, height: 100, x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement>(null)

  // Background State
  const [isRemovingBg, setIsRemovingBg] = useState(false)
  const [selectedModel, setSelectedModel] = useState('isnet_fp16')
  const [bgType, setBgType] = useState<'transparent' | 'color' | 'image'>('transparent')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [bgImage, setBgImage] = useState<string | null>(null)

  // Enhance State
  const defaultFilters = { b: 100, c: 100, s: 100, sep: 0 }
  const [liveFilters, setLiveFilters] = useState(defaultFilters)

  // Export State
  const [exportFormat, setExportFormat] = useState<string>('image/png')
  const [compressionQuality, setCompressionQuality] = useState<number>(90)

  const pushToGlobalHistory = (newImageUrl: string) => setHistory(prev => [...prev, newImageUrl])
  const handleUndo = () => { if (canUndo) setHistory(prev => prev.slice(0, -1)) }

  const handleRemoveBg = async () => {
    setIsRemovingBg(true)
    try {
      const optimizedImage = await optimizeImageForAI(currentImage)
      const bgConfig: Config = { model: selectedModel as any, output: { format: "image/png" } }
      const imageBlob = await removeBackground(optimizedImage, bgConfig) 
      pushToGlobalHistory(URL.createObjectURL(imageBlob))
    } catch (error) {
      alert("Failed to remove background.")
    } finally {
      setIsRemovingBg(false)
    }
  }

  const handleApplyTransform = async () => {
    const img = await createImage(currentImage)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const isRotated = liveTransform.rotate % 180 !== 0
    canvas.width = isRotated ? img.height : img.width
    canvas.height = isRotated ? img.width : img.height

    // Apply Legacy-Safe Corner Radius Clipping
    if (liveTransform.radius > 0) {
      const r = (Math.min(canvas.width, canvas.height) / 2) * (liveTransform.radius / 50)
      ctx.beginPath()
      ctx.moveTo(r, 0)
      ctx.lineTo(canvas.width - r, 0)
      ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r)
      ctx.lineTo(canvas.width, canvas.height - r)
      ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - r, canvas.height)
      ctx.lineTo(r, canvas.height)
      ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - r)
      ctx.lineTo(0, r)
      ctx.quadraticCurveTo(0, 0, r, 0)
      ctx.closePath()
      ctx.clip()
    }

    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((liveTransform.rotate * Math.PI) / 180)
    ctx.scale(liveTransform.flipH ? -1 : 1, liveTransform.flipV ? -1 : 1)
    ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height)

    pushToGlobalHistory(canvas.toDataURL('image/png'))
    setActiveTool(null)
    setLiveTransform({ rotate: 0, flipH: false, flipV: false, radius: 0 })
  }

  const handleApplyCrop = async () => {
    if (!imgRef.current || crop.width === 0 || crop.height === 0) return
    const image = imgRef.current
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scaleX = image.naturalWidth / image.width
    const scaleY = image.naturalHeight / image.height

    canvas.width = crop.width * scaleX
    canvas.height = crop.height * scaleY

    ctx.drawImage(
      image,
      crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY,
      0, 0, crop.width * scaleX, crop.height * scaleY
    )
    pushToGlobalHistory(canvas.toDataURL('image/png'))
    setActiveTool(null)
    setCrop({ unit: '%', width: 100, height: 100, x: 0, y: 0 })
  }

  const handleAutoEnhance = () => {
    setLiveFilters({ b: 110, c: 105, s: 115, sep: 0 })
  }

  const handleApplyEnhancements = async () => {
    const img = await createImage(currentImage)
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.filter = `brightness(${liveFilters.b}%) contrast(${liveFilters.c}%) saturate(${liveFilters.s}%) sepia(${liveFilters.sep}%)`
    ctx.drawImage(img, 0, 0)
    
    pushToGlobalHistory(canvas.toDataURL('image/png'))
    setActiveTool(null)
    setLiveFilters(defaultFilters)
  }

  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setBgImage(URL.createObjectURL(e.target.files[0]))
      setBgType('image')
    }
  }

  const handleExport = async () => {
    const img = await createImage(currentImage)

    // 1. PDF Export Path
    if (exportFormat === 'application/pdf') {
      const pdf = new jsPDF({ orientation: img.width > img.height ? 'landscape' : 'portrait', unit: 'px', format: [img.width, img.height] })
      pdf.addImage(currentImage, 'PNG', 0, 0, img.width, img.height)
      pdf.save(`${baseName}_zs_converter.pdf`)
      onComplete(currentImage)
      return
    }

    // 2. ICO Favicon (32x32) Export Path
    if (exportFormat === 'image/x-icon') {
      const icoCanvas = document.createElement('canvas')
      icoCanvas.width = 32
      icoCanvas.height = 32
      const icoCtx = icoCanvas.getContext('2d')
      if (!icoCtx) return

      if (bgType === 'color') {
        icoCtx.fillStyle = bgColor
        icoCtx.fillRect(0, 0, 32, 32)
      } else if (bgType === 'image' && bgImage) {
        const bgImgObj = await createImage(bgImage)
        icoCtx.drawImage(bgImgObj, 0, 0, 32, 32)
      }

      icoCtx.drawImage(img, 0, 0, 32, 32)

      const pngBlob = await new Promise<Blob | null>(resolve => icoCanvas.toBlob(resolve, 'image/png'))
      if (!pngBlob) return

      const pngBuffer = await pngBlob.arrayBuffer()
      const pngBytes = new Uint8Array(pngBuffer)

      const icoBuffer = new ArrayBuffer(22 + pngBytes.length)
      const view = new DataView(icoBuffer)

      view.setUint16(0, 0, true)
      view.setUint16(2, 1, true)
      view.setUint16(4, 1, true)
      view.setUint8(6, 32)
      view.setUint8(7, 32)
      view.setUint8(8, 0)
      view.setUint8(9, 0)
      view.setUint16(10, 1, true)
      view.setUint16(12, 32, true)
      view.setUint32(14, pngBytes.length, true)
      view.setUint32(18, 22, true)
      new Uint8Array(icoBuffer, 22).set(pngBytes)

      const icoBlob = new Blob([icoBuffer], { type: 'image/x-icon' })
      const finalUrl = URL.createObjectURL(icoBlob)
      const link = document.createElement('a')
      link.href = finalUrl
      link.download = `${baseName}_zs_converter.ico`
      link.click()
      
      onComplete(finalUrl)
      return
    }

    // 3. Standard Raster Image Export Path
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (bgType === 'color') {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    } else if (bgType === 'image' && bgImage) {
      const bgImgObj = await createImage(bgImage)
      ctx.drawImage(bgImgObj, 0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(img, 0, 0)

    let mimeType = exportFormat
    let quality = compressionQuality / 100
    if (exportFormat === 'image/webp-lossless' || exportFormat === 'image/png') quality = 1.0
    if (exportFormat === 'image/webp-lossless') mimeType = 'image/webp'

    const finalUrl = canvas.toDataURL(mimeType, quality)
    const link = document.createElement('a')
    link.href = finalUrl
    const ext = mimeType.split('/')[1]
    link.download = `${baseName}_zs_converter.${ext}`
    link.click()
    
    onComplete(finalUrl)
  }

  const isLosslessFormat = exportFormat === 'image/png' || exportFormat === 'image/webp-lossless' || exportFormat === 'application/pdf' || exportFormat === 'image/x-icon'
  const sourceFormatDisplay = file.type.split('/')[1]?.toUpperCase() || 'UNKNOWN'

  // Combine Active Tool Preview Styles
  const previewStyle = {
    ...(activeTool === 'enhance' ? { filter: `brightness(${liveFilters.b}%) contrast(${liveFilters.c}%) saturate(${liveFilters.s}%) sepia(${liveFilters.sep}%)` } : {}),
    ...(activeTool === 'transform' ? { 
      transform: `rotate(${liveTransform.rotate}deg) scaleX(${liveTransform.flipH ? -1 : 1}) scaleY(${liveTransform.flipV ? -1 : 1})`,
      borderRadius: `${liveTransform.radius}%`
    } : {})
  }

  return (
    <div className="bg-white w-full rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px] overflow-hidden">
      
      {/* Dynamic Preview Area */}
      <div className="flex-1 bg-slate-100 p-4 flex items-center justify-center relative group min-h-[400px] lg:min-h-full order-1 lg:order-2 overflow-hidden">
        <button onClick={onCancel} className="absolute top-3 right-3 z-50 bg-white/90 text-slate-800 p-2 rounded-full shadow-md hover:bg-red-500 hover:text-white transition-colors" title="Close Image">
          <X className="w-5 h-5" />
        </button>

        <div className="absolute inset-0 z-0" style={{ backgroundColor: bgType === 'color' ? bgColor : 'transparent', backgroundImage: bgType === 'image' && bgImage ? `url(${bgImage})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center' }} />
        
        <div className="relative z-10 w-full h-full flex items-center justify-center p-2">
          {activeTool === 'crop' ? (
            <ReactCrop crop={crop} onChange={c => setCrop(c)} className="max-w-full max-h-full flex items-center justify-center">
              <img ref={imgRef} src={currentImage} alt="Crop Preview" className="max-w-full max-h-full object-contain" style={previewStyle} />
            </ReactCrop>
          ) : (
            <img src={currentImage} alt="Workspace" className="max-w-full max-h-full object-contain drop-shadow-md transition-all" style={previewStyle} />
          )}
        </div>
      </div>

      {/* Toolbar Sidebar */}
      <div className="w-full lg:w-80 h-auto lg:h-full flex flex-col gap-4 overflow-y-auto p-4 lg:p-6 bg-slate-50 border-b lg:border-b-0 lg:border-r border-slate-200 order-2 lg:order-1">
        <div className="flex justify-between items-center border-b border-slate-200 pb-2 flex-shrink-0">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2"><Settings2 className="w-4 h-4" /> Tools</h4>
          <button onClick={handleUndo} disabled={!canUndo} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-[#6384A3] disabled:opacity-30 transition-colors">
            <Undo2 className="w-3 h-3" /> Undo
          </button>
        </div>
        
        {/* Background Tool */}
        <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white">
          <button onClick={() => setActiveTool(activeTool === 'bg' ? null : 'bg')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
            <Eraser className="w-4 h-4 text-[#6384A3]" /> Background Studio
          </button>
          {activeTool === 'bg' && (
            <div className="p-4 bg-white space-y-4 border-t border-slate-100">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">1. AI Removal Model</label>
                <CustomDropdown 
                  value={selectedModel} 
                  onChange={setSelectedModel} 
                  options={[
                    { value: 'isnet_quint8', label: 'Light Model (Fastest)' },
                    { value: 'isnet_fp16', label: 'Medium Model (Balanced)' },
                    { value: 'isnet', label: 'Heavy Model (Highest Quality)' }
                  ]}
                />
                <button onClick={handleRemoveBg} disabled={isRemovingBg} className="w-full py-2.5 mt-2 bg-[#6384A3] text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-[#4f6a83] disabled:opacity-50">
                  {isRemovingBg ? 'Processing...' : 'Run Eraser'}
                </button>
              </div>
              <div className="space-y-2 pt-3 border-t border-slate-100">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">2. Replace Background</label>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setBgType('transparent')} className={`flex-1 py-1.5 text-xs font-bold rounded border ${bgType === 'transparent' ? 'bg-[#6384A3] text-white' : 'bg-slate-50 text-slate-600'}`}>None</button>
                  <button onClick={() => setBgType('color')} className={`flex-1 py-1.5 text-xs font-bold rounded border flex items-center justify-center gap-1 ${bgType === 'color' ? 'bg-[#6384A3] text-white' : 'bg-slate-50 text-slate-600'}`}><Palette className="w-3 h-3"/> Color</button>
                  <button onClick={() => document.getElementById('bg-upload')?.click()} className={`flex-1 py-1.5 text-xs font-bold rounded border flex items-center justify-center gap-1 ${bgType === 'image' ? 'bg-[#6384A3] text-white' : 'bg-slate-50 text-slate-600'}`}><ImageIcon className="w-3 h-3"/> Image</button>
                  <input type="file" id="bg-upload" accept="image/*" className="hidden" onChange={handleBgImageUpload} />
                </div>
                {bgType === 'color' && <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-full h-8 rounded cursor-pointer" />}
              </div>
            </div>
          )}
        </div>

        {/* Transform & Shape Tool */}
        <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white">
          <button onClick={() => setActiveTool(activeTool === 'transform' ? null : 'transform')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
            <RotateCw className="w-4 h-4 text-[#6384A3]" /> Transform & Shape
          </button>
          {activeTool === 'transform' && (
            <div className="p-4 bg-white border-t border-slate-100 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setLiveTransform(prev => ({ ...prev, rotate: (prev.rotate + 90) % 360 }))} className="py-2 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100 flex flex-col items-center gap-1">
                  <RotateCw className="w-4 h-4 text-[#6384A3]" /> Rotate
                </button>
                <button onClick={() => setLiveTransform(prev => ({ ...prev, flipH: !prev.flipH }))} className="py-2 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100 flex flex-col items-center gap-1">
                  <FlipHorizontal className="w-4 h-4 text-[#6384A3]" /> Mirror
                </button>
                <button onClick={() => setLiveTransform(prev => ({ ...prev, flipV: !prev.flipV }))} className="py-2 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100 flex flex-col items-center gap-1">
                  <FlipVertical className="w-4 h-4 text-[#6384A3]" /> Flip
                </button>
              </div>
              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  <span className="flex items-center gap-1"><Square className="w-3 h-3" /> Corner Radius</span>
                  <span className="text-[#6384A3]">{liveTransform.radius}%</span>
                </div>
                <input type="range" min="0" max="50" value={liveTransform.radius} onChange={(e) => setLiveTransform({...liveTransform, radius: Number(e.target.value)})} className="w-full accent-[#6384A3]" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setActiveTool(null); setLiveTransform({ rotate: 0, flipH: false, flipV: false, radius: 0 }); }} className="flex-1 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                <button onClick={handleApplyTransform} className="flex-1 py-2 text-xs font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply</button>
              </div>
            </div>
          )}
        </div>
        
        {/* Crop Tool */}
        <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white">
          <button onClick={() => setActiveTool(activeTool === 'crop' ? null : 'crop')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
            <CropIcon className="w-4 h-4 text-[#6384A3]" /> Freehand Crop
          </button>
          {activeTool === 'crop' && (
            <div className="p-4 bg-white border-t border-slate-100 space-y-3">
              <p className="text-xs text-slate-500">Drag the edges on the image preview to define your custom crop area.</p>
              <div className="flex gap-2">
                <button onClick={() => setActiveTool(null)} className="flex-1 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                <button onClick={handleApplyCrop} className="flex-1 py-2 text-xs font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply Crop</button>
              </div>
            </div>
          )}
        </div>

        {/* Enhance Tool */}
        <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white">
          <button onClick={() => setActiveTool(activeTool === 'enhance' ? null : 'enhance')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
            <Sparkles className="w-4 h-4 text-[#6384A3]" /> Enhance Photo
          </button>
          {activeTool === 'enhance' && (
            <div className="p-4 bg-white border-t border-slate-100 space-y-4">
              <div className="flex justify-end">
                <button onClick={handleAutoEnhance} className="py-1.5 px-3 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 hover:bg-indigo-100 transition-colors">
                  <Wand2 className="w-3 h-3" /> Auto Enhance
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Brightness</label>
                  <input type="range" min="50" max="150" value={liveFilters.b} onChange={(e) => setLiveFilters({...liveFilters, b: Number(e.target.value)})} className="w-full accent-[#6384A3]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Contrast</label>
                  <input type="range" min="50" max="150" value={liveFilters.c} onChange={(e) => setLiveFilters({...liveFilters, c: Number(e.target.value)})} className="w-full accent-[#6384A3]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Saturation</label>
                  <input type="range" min="0" max="200" value={liveFilters.s} onChange={(e) => setLiveFilters({...liveFilters, s: Number(e.target.value)})} className="w-full accent-[#6384A3]" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Warmth</label>
                  <input type="range" min="0" max="100" value={liveFilters.sep} onChange={(e) => setLiveFilters({...liveFilters, sep: Number(e.target.value)})} className="w-full accent-[#6384A3]" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setActiveTool(null); setLiveFilters(defaultFilters); }} className="flex-1 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                <button onClick={handleApplyEnhancements} className="flex-1 py-2 text-xs font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply Filters</button>
              </div>
            </div>
          )}
        </div>

        {/* Inline Export & Conversion */}
        <div className="mt-auto border border-slate-200 rounded-lg bg-white p-4 space-y-4 flex-shrink-0">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2"><Type className="w-4 h-4 text-[#6384A3]"/> Conversion & Export</h4>
          <div className="space-y-2">
             <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-bold">Source: <span className="text-[#6384A3]">{sourceFormatDisplay}</span></span>
                <span className="text-slate-500 font-bold">Output:</span>
             </div>
             <CustomDropdown 
                value={exportFormat} 
                onChange={setExportFormat} 
                direction="up"
                options={[
                  { value: 'image/png', label: 'PNG (Lossless)' },
                  { value: 'image/webp-lossless', label: 'WebP (Lossless)' },
                  { value: 'image/webp', label: 'WebP (Lossy Compression)' },
                  { value: 'image/jpeg', label: 'JPG / JPEG (Lossy)' },
                  { value: 'image/x-icon', label: 'ICO Favicon (32x32)' },
                  { value: 'application/pdf', label: 'PDF Document' }
                ]}
             />
          </div>

          {!isLosslessFormat && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-500">Compression Quality</span>
                <span className="text-[#6384A3]">{compressionQuality}%</span>
              </div>
              <input type="range" value={compressionQuality} min={10} max={100} onChange={(e) => setCompressionQuality(Number(e.target.value))} className="w-full accent-[#6384A3]" />
            </div>
          )}
          <button onClick={handleExport} className="w-full py-3 px-4 bg-[#6384A3] text-white rounded-lg hover:bg-[#4f6a83] text-center transition-colors font-bold text-sm shadow-md flex items-center justify-center gap-2">
            <Download className="w-4 h-4" /> Convert & Save
          </button>
        </div>
      </div>
    </div>
  )
}