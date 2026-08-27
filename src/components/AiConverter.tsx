'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { jsPDF } from 'jspdf'
import { writePsdBuffer } from 'ag-psd'
import * as UTIF from 'utif'
import { removeBackground, Config } from '@imgly/background-removal'
import { Settings2, Download, X, FileType2, Layers, Wand2 } from 'lucide-react'
import CustomDropdown from './CustomDropdown'

// Helper to load standard images (PNG, JPG, SVG) into the canvas
const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.src = url
  })

export default function AiConverter() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [exportFormat, setExportFormat] = useState('ai')
  
  // Layering State
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null)
  const [extractedSubject, setExtractedSubject] = useState<HTMLImageElement | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('pdfjs-dist').then((pdfjsLib) => {
        const isModernBrowser = 'noModule' in HTMLScriptElement.prototype
        pdfjsLib.GlobalWorkerOptions.workerSrc = isModernBrowser 
          ? `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
          : `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.js`
      })
    }
  }, [])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    const droppedFile = acceptedFiles[0]
    setFile(droppedFile)
    setIsProcessing(true)
    setExtractedSubject(null) // Reset layers on new file
    
    try {
      const fileName = droppedFile.name.toLowerCase()

      // PATH A: Extracting .AI or .PDF files using PDF.js
      if (fileName.endsWith('.ai') || fileName.endsWith('.pdf')) {
        const arrayBuffer = await droppedFile.arrayBuffer()
        const pdfjsLib = await import('pdfjs-dist')
        
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        const page = await pdf.getPage(1)
        
        const viewport = page.getViewport({ scale: 3.0 }) 
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        canvas.width = viewport.width
        canvas.height = viewport.height
        
        await page.render({ canvasContext: ctx, viewport } as any).promise
        
        const imgUrl = canvas.toDataURL('image/png')
        const imgObj = await createImage(imgUrl)
        setBaseImage(imgObj)
        canvasRef.current = canvas
        setPreviewUrl(imgUrl)
      } 
      // PATH B: Standard Images
      else if (droppedFile.type.startsWith('image/')) {
        const url = URL.createObjectURL(droppedFile)
        const img = await createImage(url)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        canvas.width = img.width
        canvas.height = img.height
        ctx.drawImage(img, 0, 0)
        
        setBaseImage(img)
        canvasRef.current = canvas
        setPreviewUrl(canvas.toDataURL('image/png'))
      }
    } catch (error) {
      alert("Failed to parse file. For .AI files, ensure it was saved with 'Create PDF Compatible File' enabled in Illustrator.")
      setFile(null)
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, 
    accept: { 
      'application/postscript': ['.ai', '.eps'],
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/svg+xml': ['.svg'],
      'image/webp': ['.webp']
    }, 
    maxFiles: 1
  })

  // Smart Layer Extraction
  const handleExtractLayers = async () => {
    if (!previewUrl || !baseImage) return
    setIsExtracting(true)
    try {
      // Scale down temporarily for AI processing speed
      const MAX_DIM = 1200
      let w = baseImage.width, h = baseImage.height
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM } 
        else { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM }
      }
      
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = w; tempCanvas.height = h
      const ctx = tempCanvas.getContext('2d')!
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h)
      ctx.drawImage(baseImage, 0, 0, w, h)
      
      const optimizedUrl = tempCanvas.toDataURL('image/jpeg', 0.9)
      
      const bgConfig: Config = { model: 'isnet_fp16', output: { format: "image/png" } }
      const blob = await removeBackground(optimizedUrl, bgConfig) 
      const subjectImg = await createImage(URL.createObjectURL(blob))
      
      setExtractedSubject(subjectImg)
    } catch (error) {
      alert("Failed to extract layers. The image may be too complex.")
    } finally {
      setIsExtracting(false)
    }
  }

  const generateEps = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let hex = ''
    const map = ['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F']
    for (let i = 0; i < data.length; i += 4) {
      hex += map[data[i]>>4] + map[data[i]&15] + map[data[i+1]>>4] + map[data[i+1]&15] + map[data[i+2]>>4] + map[data[i+2]&15]
      if (i > 0 && i % 120 === 0) hex += '\n'
    }
    return `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${canvas.width} ${canvas.height}\n%%EndComments\n/DeviceRGB setcolorspace\n${canvas.width} ${canvas.height} 8\n[${canvas.width} 0 0 -${canvas.height} 0 ${canvas.height}]\n{<\n${hex}\n>} false 3 colorimage\nshowpage\n%%EOF`
  }

  const handleExport = async () => {
    if (!canvasRef.current || !file || !baseImage) return
    setIsProcessing(true)
    const canvas = canvasRef.current
    let downloadUrl = ''
    let ext = exportFormat

    try {
      // PDF & AI EXPORT: Stack layers as separate editable objects
      if (exportFormat === 'pdf' || exportFormat === 'ai') {
        const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'l' : 'p', unit: 'px', format: [canvas.width, canvas.height] })
        
        pdf.addImage(baseImage.src, 'PNG', 0, 0, canvas.width, canvas.height)
        
        // If layers are extracted, draw the subject ON TOP as a separate object.
        // Illustrator will read these as two distinct, movable pieces.
        if (extractedSubject) {
          pdf.addImage(extractedSubject.src, 'PNG', 0, 0, canvas.width, canvas.height)
        }
        
        downloadUrl = URL.createObjectURL(pdf.output('blob'))
      } 
      // PSD EXPORT: Write actual Photoshop Layers
      else if (exportFormat === 'psd') {
        const children = []
        
        if (extractedSubject) {
          // Layer 1: Background
          const bgCanvas = document.createElement('canvas')
          bgCanvas.width = canvas.width; bgCanvas.height = canvas.height
          bgCanvas.getContext('2d')!.drawImage(baseImage, 0, 0)
          children.push({ name: 'Background', canvas: bgCanvas })

          // Layer 2: Foreground Subject
          const fgCanvas = document.createElement('canvas')
          fgCanvas.width = canvas.width; fgCanvas.height = canvas.height
          fgCanvas.getContext('2d')!.drawImage(extractedSubject, 0, 0, canvas.width, canvas.height)
          children.push({ name: 'Foreground Subject', canvas: fgCanvas })
        } else {
          children.push({ name: 'Layer 1', canvas })
        }

        const buffer = writePsdBuffer({ width: canvas.width, height: canvas.height, children })
        downloadUrl = URL.createObjectURL(new Blob([new Uint8Array(buffer as any)], { type: 'application/octet-stream' }))
      }
      else if (exportFormat === 'png') {
        downloadUrl = canvas.toDataURL('image/png')
      } 
      else if (exportFormat === 'jpg') {
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = canvas.width; tempCanvas.height = canvas.height
        const ctx = tempCanvas.getContext('2d')!
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height)
        ctx.drawImage(canvas, 0, 0)
        downloadUrl = tempCanvas.toDataURL('image/jpeg', 0.95)
      } 
      else if (exportFormat === 'svg') {
        const svgStr = `<svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg"><image href="${canvas.toDataURL('image/png')}" width="${canvas.width}" height="${canvas.height}"/></svg>`
        downloadUrl = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }))
      } 
      else if (exportFormat === 'tiff') {
        const imageData = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        const rgba = new Uint8Array(imageData.data.buffer)
        const tiffBuffer = UTIF.encodeImage(rgba, canvas.width, canvas.height)
        downloadUrl = URL.createObjectURL(new Blob([new Uint8Array(tiffBuffer as any)], { type: 'image/tiff' }))
      } 
      else if (exportFormat === 'eps') {
        const epsStr = generateEps(canvas)
        downloadUrl = URL.createObjectURL(new Blob([epsStr], { type: 'application/postscript' }))
      }

      const link = document.createElement('a')
      link.href = downloadUrl
      const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name
      link.download = `${originalName}_zs_converter.${ext}`
      link.click()
    } catch (e) {
      alert("Conversion failed.")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px]">
      
      {/* Sidebar Workspace */}
      <div className="w-full lg:w-80 h-auto lg:h-full bg-slate-50 p-4 lg:p-6 border-t lg:border-t-0 lg:border-r border-slate-200 flex flex-col gap-4 lg:gap-6 order-2 lg:order-1 overflow-y-auto">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest border-b pb-4 flex items-center gap-2 flex-shrink-0">
          <Settings2 className="w-4 h-4"/> Universal Vector Studio
        </h3>
        
        {file && (
          <div className="space-y-3 flex-shrink-0 border border-slate-200 bg-white rounded-lg p-4 shadow-sm">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-2">
              <Layers className="w-3 h-3" /> Layer Management
            </h4>
            {extractedSubject ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 font-bold">
                  <span>Layer 1: Background</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-700 font-bold">
                  <span>Layer 2: Foreground Subject</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-2 leading-tight">Layers will export distinctly in AI and PSD formats.</p>
              </div>
            ) : (
              <div className="space-y-2 text-center">
                <p className="text-[10px] text-slate-500 mb-2">Currently a flat image. Extract the subject to create distinct layers for AI/PSD export.</p>
                <button onClick={handleExtractLayers} disabled={isExtracting} className="w-full py-2 bg-slate-800 text-white rounded text-[10px] uppercase font-bold tracking-widest hover:bg-black transition-colors shadow-sm disabled:opacity-50 flex justify-center items-center gap-1">
                  {isExtracting ? 'Analyzing Image...' : <><Wand2 className="w-3 h-3"/> Extract Subject Layer</>}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3 flex-shrink-0">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Output Format</label>
          <CustomDropdown 
            value={exportFormat} onChange={setExportFormat} disabled={isProcessing || !file} direction="down"
            options={[
              { value: 'ai', label: 'AI (Adobe Illustrator)' },
              { value: 'pdf', label: 'PDF (Vector/Print)' },
              { value: 'psd', label: 'PSD (Photoshop Layer)' },
              { value: 'svg', label: 'SVG (High-Res Embed)' },
              { value: 'eps', label: 'EPS (Legacy Print)' },
              { value: 'tiff', label: 'TIFF (Lossless Print)' },
              { value: 'png', label: 'PNG (Transparent Raster)' },
              { value: 'jpg', label: 'JPG / JPEG (Standard)' }
            ]}
          />
        </div>

        <div className="mt-auto border-t border-slate-200 pt-6 space-y-3 flex-shrink-0">
          <button onClick={handleExport} disabled={isProcessing || !file} className="w-full py-3 bg-[#6384A3] text-white font-bold rounded-lg hover:bg-[#4f6a83] disabled:opacity-50 shadow-md transition-colors flex items-center justify-center gap-2">
            {isProcessing ? 'Processing...' : <><Download className="w-4 h-4"/> Convert & Export</>}
          </button>
        </div>
      </div>

      {/* Main Image Area */}
      <div className="flex-1 p-4 lg:p-8 relative h-full flex flex-col min-h-[400px] lg:min-h-full order-1 lg:order-2 bg-white">
        {!file ? (
          <div {...getRootProps()} className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors p-6 ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-slate-100/50'}`}>
            <input {...getInputProps()} />
            <FileType2 className={`w-10 h-10 lg:w-12 lg:h-12 mb-4 ${isDragActive ? 'text-[#6384A3]' : 'text-slate-300'}`} />
            <h3 className="text-sm lg:text-lg font-bold text-slate-700 mb-1">Drop an .AI, PNG, JPG, or SVG File</h3>
            <p className="text-xs text-slate-500 mt-1">For .AI inputs, "Create PDF Compatible File" must be enabled.</p>
          </div>
        ) : (
          <div className="flex-1 bg-slate-100 rounded-lg p-4 flex items-center justify-center relative overflow-hidden">
            <button onClick={() => { setFile(null); setPreviewUrl(null); setExtractedSubject(null); }} className="absolute top-3 right-3 z-50 bg-white/90 text-slate-800 p-2 rounded-full shadow-md hover:bg-red-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
            {previewUrl ? (
              <div className="relative max-w-full max-h-full flex items-center justify-center">
                <img src={previewUrl} alt="Base Layer" className="max-w-full max-h-full object-contain drop-shadow-lg" />
                {extractedSubject && (
                   <img src={extractedSubject.src} alt="Extracted Overlay" className="absolute top-0 left-0 w-full h-full object-contain mix-blend-normal opacity-90 drop-shadow-2xl border-2 border-dashed border-indigo-400" />
                )}
              </div>
            ) : (
              <p className="text-slate-500 font-bold animate-pulse text-sm">Rendering Graphics...</p>
            )}
          </div>
        )}
      </div>
      
    </div>
  )
}