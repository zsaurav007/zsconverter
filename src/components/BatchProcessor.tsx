'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import JSZip from 'jszip'
import { Settings2, UploadCloud, Layers, Eraser, Trash2, Maximize } from 'lucide-react'
import { removeBackground, Config } from '@imgly/background-removal'
import CustomDropdown from './CustomDropdown'

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
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
    if (width > height) {
      height = Math.round((height * MAX_DIM) / width)
      width = MAX_DIM
    } else {
      width = Math.round((width * MAX_DIM) / height)
      height = MAX_DIM
    }
  }
  
  canvas.width = width
  canvas.height = height
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.95)
}

export default function BatchProcessor() {
  const [files, setFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const [exportFormat, setExportFormat] = useState('image/webp-lossless')
  const [quality, setQuality] = useState(90)
  
  // Resizing State
  const [resizeWidth, setResizeWidth] = useState<number | ''>('')
  const [resizeHeight, setResizeHeight] = useState<number | ''>('')
  const [maintainRatio, setMaintainRatio] = useState(true)
  const [presetSize, setPresetSize] = useState('custom')
  
  const [enableBgRemoval, setEnableBgRemoval] = useState(false)
  const [bgModel, setBgModel] = useState('isnet_quint8')

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles])
  }, [])
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, 
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] }
  })

  const removeFile = (indexToRemove: number) => {
    setFiles(files.filter((_, index) => index !== indexToRemove))
  }
  
  const clearAll = () => setFiles([])

  const handlePresetChange = (val: string) => {
    setPresetSize(val)
    if (val !== 'custom') {
      const [w, h] = val.split('x').map(Number)
      setResizeWidth(w)
      setResizeHeight(h)
      // For fixed specific sizes like Passport/Stamp, we typically stretch/crop to exact box
      setMaintainRatio(false) 
    }
  }

  const handleBatchProcess = async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    setProgress({ current: 0, total: files.length })
    const zip = new JSZip()

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        let url = URL.createObjectURL(file)

        if (enableBgRemoval) {
          const optimized = await optimizeImageForAI(url)
          const bgConfig: Config = { model: bgModel as any, output: { format: "image/png" } }
          const imageBlob = await removeBackground(optimized, bgConfig)
          url = URL.createObjectURL(imageBlob)
        }

        const img = await createImage(url)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) continue

        let targetWidth = img.width
        let targetHeight = img.height
        
        const rw = typeof resizeWidth === 'number' ? resizeWidth : null;
        const rh = typeof resizeHeight === 'number' ? resizeHeight : null;

        if (rw || rh) {
          if (maintainRatio) {
            if (rw && rh) {
              // Bounding box logic: fit within rw x rh while maintaining ratio
              const ratio = Math.min(rw / img.width, rh / img.height);
              targetWidth = Math.max(1, Math.round(img.width * ratio));
              targetHeight = Math.max(1, Math.round(img.height * ratio));
            } else if (rw) {
              targetWidth = rw;
              targetHeight = Math.max(1, Math.round((img.height * rw) / img.width));
            } else if (rh) {
              targetHeight = rh;
              targetWidth = Math.max(1, Math.round((img.width * rh) / img.height));
            }
          } else {
            // Force exact dimensions (will squish/stretch if ratio doesn't match)
            targetWidth = rw || img.width;
            targetHeight = rh || img.height;
          }
        }

        canvas.width = targetWidth
        canvas.height = targetHeight

        if (exportFormat === 'image/jpeg') {
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, targetWidth, targetHeight)
        }
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

        let mimeType = exportFormat
        let compressionTarget = quality / 100
        if (exportFormat === 'image/webp-lossless' || exportFormat === 'image/png') compressionTarget = 1.0 
        if (exportFormat === 'image/webp-lossless') mimeType = 'image/webp'

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), mimeType, compressionTarget)
        })

        if (blob) {
          const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name
          const extension = mimeType.split('/')[1]
          zip.file(`${originalName}_zs_converter.${extension}`, blob)
        }
        
        URL.revokeObjectURL(url)
        setProgress({ current: i + 1, total: files.length })
      }

      const zipContent = await zip.generateAsync({ type: 'blob' })
      const downloadUrl = URL.createObjectURL(zipContent)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `batch_${Date.now()}_zs_converter.zip`
      link.click()

    } catch (error) {
      alert("An error occurred during batch processing.")
    } finally {
      setIsProcessing(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  const isLosslessFormat = exportFormat === 'image/png' || exportFormat === 'image/webp-lossless'

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px]">
      
      {/* Settings Panel */}
      <div className="w-full lg:w-80 h-auto lg:h-full bg-slate-50 p-4 lg:p-6 border-t lg:border-t-0 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col gap-4 lg:gap-6 overflow-y-auto order-2 lg:order-1">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest border-b pb-4 flex items-center gap-2 flex-shrink-0">
          <Settings2 className="w-4 h-4"/> Batch Pipeline
        </h3>
        
        <div className="space-y-3 flex-shrink-0">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Output Format</label>
          <CustomDropdown 
            value={exportFormat} 
            onChange={setExportFormat} 
            disabled={isProcessing}
            direction="down"
            options={[
              { value: 'image/png', label: 'PNG (Lossless)' },
              { value: 'image/webp-lossless', label: 'WebP (Lossless)' },
              { value: 'image/webp', label: 'WebP (Lossy Compression)' },
              { value: 'image/jpeg', label: 'JPG / JPEG (Lossy)' }
            ]}
          />
        </div>

        {!isLosslessFormat && (
          <div className="space-y-3 flex-shrink-0">
            <div className="flex justify-between text-xs font-bold text-slate-700 uppercase tracking-wider">
              <span>Quality</span>
              <span className="text-[#6384A3]">{quality}%</span>
            </div>
            <input type="range" min="10" max="100" value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={isProcessing} className="w-full accent-[#6384A3] disabled:opacity-50" />
          </div>
        )}

        {/* Resizing Options */}
        <div className="space-y-3 border-t border-slate-200 pt-4 flex-shrink-0">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
            <Maximize className="w-4 h-4 text-[#6384A3]"/> Dimension & Resizing
          </label>
          
          <CustomDropdown 
            value={presetSize} 
            onChange={handlePresetChange} 
            disabled={isProcessing}
            direction="down"
            options={[
              { value: 'custom', label: 'Custom Freeform' },
              { value: '600x600', label: 'US Passport (2x2 in) - 600x600' },
              { value: '413x531', label: 'UK/EU Passport - 413x531' },
              { value: '354x472', label: 'Stamp Size - 354x472' },
              { value: '1920x1080', label: 'Full HD (1080p) - 1920x1080' },
              { value: '1280x720', label: 'HD (720p) - 1280x720' },
              { value: '1080x1080', label: 'Instagram Square - 1080x1080' },
            ]}
          />

          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Width (px)</label>
              <input 
                type="number" 
                placeholder="Auto" 
                value={resizeWidth} 
                onChange={(e) => { setResizeWidth(e.target.value ? Number(e.target.value) : ''); setPresetSize('custom'); }} 
                disabled={isProcessing} 
                className="w-full p-2 border border-slate-200 rounded text-sm bg-white disabled:opacity-50" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Height (px)</label>
              <input 
                type="number" 
                placeholder="Auto" 
                value={resizeHeight} 
                onChange={(e) => { setResizeHeight(e.target.value ? Number(e.target.value) : ''); setPresetSize('custom'); }} 
                disabled={isProcessing} 
                className="w-full p-2 border border-slate-200 rounded text-sm bg-white disabled:opacity-50" 
              />
            </div>
          </div>
          
          <label className="flex items-center gap-2 mt-2 text-[11px] font-semibold text-slate-600 cursor-pointer">
            <input 
              type="checkbox" 
              checked={maintainRatio} 
              onChange={(e) => setMaintainRatio(e.target.checked)} 
              disabled={isProcessing} 
              className="w-3.5 h-3.5 accent-[#6384A3] rounded disabled:opacity-50 cursor-pointer" 
            />
            Maintain Aspect Ratio (Fit Inside)
          </label>
        </div>

        {/* Batch AI Removal */}
        <div className="space-y-3 border-t border-slate-200 pt-4 flex-shrink-0">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider cursor-pointer">
            <input type="checkbox" checked={enableBgRemoval} onChange={(e) => setEnableBgRemoval(e.target.checked)} disabled={isProcessing} className="w-4 h-4 accent-[#6384A3] rounded disabled:opacity-50" />
            <Eraser className="w-4 h-4 text-[#6384A3]"/> Batch AI Erase
          </label>
          {enableBgRemoval && (
            <div className="animate-in fade-in space-y-2 pt-2">
              <p className="text-[10px] text-orange-600 font-bold uppercase tracking-widest">Note: AI processing on large batches may take a long time.</p>
              <CustomDropdown 
                value={bgModel} 
                onChange={setBgModel} 
                disabled={isProcessing}
                direction="up"
                options={[
                  { value: 'isnet_quint8', label: 'Light (Best for Batches)' },
                  { value: 'isnet_fp16', label: 'Medium (Slower)' },
                  { value: 'isnet', label: 'Heavy (Extremely Slow)' }
                ]}
              />
            </div>
          )}
        </div>

        <div className="mt-auto pt-6 border-t border-slate-200 flex-shrink-0">
          <button onClick={handleBatchProcess} disabled={isProcessing || files.length === 0} className="w-full py-3 bg-[#6384A3] text-white font-bold rounded-lg hover:bg-[#4f6a83] disabled:opacity-50 shadow-md transition-colors flex items-center justify-center gap-2">
            {isProcessing ? `Processing ${progress.current}/${progress.total}...` : <><Layers className="w-4 h-4"/> Start Batch Job</>}
          </button>
        </div>
      </div>

      {/* Dropzone & Queue */}
      <div className="flex-1 p-4 lg:p-8 flex flex-col relative min-h-[400px] lg:min-h-full order-1 lg:order-2">
        {files.length > 0 && !isProcessing && (
          <button onClick={clearAll} className="absolute top-2 lg:top-4 right-2 lg:right-4 z-10 bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-2 transition-colors shadow-sm">
            <Trash2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Clear Queue</span>
          </button>
        )}

        <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-6 lg:p-8 mb-4 lg:mb-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-slate-100/50'} ${isProcessing ? 'pointer-events-none opacity-50' : ''}`}>
          <input {...getInputProps()} />
          <UploadCloud className={`w-8 h-8 lg:w-10 lg:h-10 mb-3 ${isDragActive ? 'text-[#6384A3]' : 'text-slate-400'}`} />
          <h3 className="text-base lg:text-lg font-bold text-slate-700 mb-1">Add Images to Batch</h3>
          <p className="text-xs text-slate-500">Drag & drop files, or tap to browse</p>
        </div>

        {files.length > 0 && (
          <div className="flex-1 bg-white border border-slate-200 rounded-lg p-3 lg:p-4 overflow-y-auto">
            <div className="flex justify-between items-center mb-3 lg:mb-4 border-b pb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{files.length} Files Queued</span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="relative group rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-50 flex items-center justify-center">
                  <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />
                  {!isProcessing && (
                    <button 
                      onClick={() => removeFile(index)} 
                      className="absolute top-2 right-2 bg-red-500/90 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-md opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] p-1.5 truncate text-center font-semibold flex justify-between px-2">
                    <span className="truncate pr-2">{file.name}</span>
                    <span className="text-slate-300">{file.type.split('/')[1]?.toUpperCase()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}