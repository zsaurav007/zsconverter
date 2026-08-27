'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import * as pdfjsLib from 'pdfjs-dist'
import { jsPDF } from 'jspdf'
import { writePsdBuffer } from 'ag-psd'
import * as UTIF from 'utif'
import { Settings2, Download, UploadCloud, X, FileType2 } from 'lucide-react'
import CustomDropdown from './CustomDropdown'

export default function AiConverter() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [exportFormat, setExportFormat] = useState('pdf')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
    }
  }, [])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    const aiFile = acceptedFiles[0]
    setFile(aiFile)
    setIsProcessing(true)
    
    try {
      const arrayBuffer = await aiFile.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const page = await pdf.getPage(1)
      
      const viewport = page.getViewport({ scale: 3.0 }) // Render high-res internally
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: ctx, viewport }).promise
      
      canvasRef.current = canvas
      setPreviewUrl(canvas.toDataURL('image/png'))
    } catch (error) {
      alert("Failed to parse AI file. Ensure it was saved with 'Create PDF Compatible File' enabled in Illustrator.")
      setFile(null)
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/postscript': ['.ai'] }, maxFiles: 1
  })

  // EPS Raw Hex Generator
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
    if (!canvasRef.current || !file) return
    setIsProcessing(true)
    const canvas = canvasRef.current
    let downloadUrl = ''
    let ext = exportFormat

    try {
      if (exportFormat === 'pdf') {
        const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'l' : 'p', unit: 'px', format: [canvas.width, canvas.height] })
        pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, canvas.width, canvas.height)
        downloadUrl = URL.createObjectURL(pdf.output('blob'))
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
      else if (exportFormat === 'psd') {
        // Native browser canvas is explicitly supported here
        const buffer = writePsdBuffer({ width: canvas.width, height: canvas.height, children: [{ name: 'AI Layer', canvas }] })
        downloadUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }))
      } 
      else if (exportFormat === 'tiff') {
        const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        const tiffBuffer = UTIF.encodeImage(rgba, canvas.width, canvas.height)
        downloadUrl = URL.createObjectURL(new Blob([tiffBuffer], { type: 'image/tiff' }))
      } 
      else if (exportFormat === 'eps') {
        const epsStr = generateEps(canvas)
        downloadUrl = URL.createObjectURL(new Blob([epsStr], { type: 'application/postscript' }))
      }

      const link = document.createElement('a')
      link.href = downloadUrl
      const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name
      link.download = `${originalName}-converted.${ext}`
      link.click()
    } catch (e) {
      alert("Conversion failed.")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row h-[650px]">
      <div className="w-full md:w-80 h-full bg-slate-50 p-6 border-r border-slate-200 flex flex-col gap-6">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest border-b pb-4 flex items-center gap-2"><Settings2 className="w-4 h-4"/> AI Engine</h3>
        
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Output Format</label>
          <CustomDropdown 
            value={exportFormat} onChange={setExportFormat} disabled={isProcessing || !file} direction="down"
            options={[
              { value: 'pdf', label: 'PDF (Vector/Print)' },
              { value: 'svg', label: 'SVG (High-Res Embed)' },
              { value: 'eps', label: 'EPS (Legacy Print)' },
              { value: 'psd', label: 'PSD (Photoshop Layer)' },
              { value: 'tiff', label: 'TIFF (Lossless Print)' },
              { value: 'png', label: 'PNG (Transparent Raster)' },
              { value: 'jpg', label: 'JPG / JPEG (Standard)' }
            ]}
          />
        </div>

        <div className="mt-auto border-t border-slate-200 pt-6 space-y-3">
          <button onClick={handleExport} disabled={isProcessing || !file} className="w-full py-3 bg-[#6384A3] text-white font-bold rounded-lg hover:bg-[#4f6a83] disabled:opacity-50 shadow-md transition-colors flex items-center justify-center gap-2">
            {isProcessing ? 'Processing...' : <><Download className="w-4 h-4"/> Export Vector</>}
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 md:p-8 relative h-full flex flex-col">
        {!file ? (
          <div {...getRootProps()} className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-slate-100/50'}`}>
            <input {...getInputProps()} />
            <FileType2 className={`w-12 h-12 mb-4 ${isDragActive ? 'text-[#6384A3]' : 'text-slate-300'}`} />
            <h3 className="text-lg font-bold text-slate-700 mb-1">Drop an .AI File</h3>
            <p className="text-xs text-slate-500">Requires "Create PDF Compatible File" to be enabled.</p>
          </div>
        ) : (
          <div className="flex-1 bg-slate-100 rounded-lg p-4 flex items-center justify-center relative">
            <button onClick={() => { setFile(null); setPreviewUrl(null); }} className="absolute top-3 right-3 z-50 bg-white/90 text-slate-800 p-2 rounded-full shadow-md hover:bg-red-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            {previewUrl ? <img src={previewUrl} alt="AI Preview" className="max-w-full max-h-full object-contain drop-shadow-lg" /> : <p className="text-slate-500 font-bold animate-pulse">Rendering Vector Graphics...</p>}
          </div>
        )}
      </div>
    </div>
  )
}