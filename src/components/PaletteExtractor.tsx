'use client'

import { useState, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Palette, Image as ImageIcon, Copy, X, Pipette } from 'lucide-react'

// --- HELPER FUNCTIONS ---
const rgbToHex = (r: number, g: number, b: number) => {
  return '#' + [r, g, b].map(x => Math.min(255, Math.max(0, x)).toString(16).padStart(2, '0')).join('')
}

const colorDistance = (hex1: string, hex2: string) => {
  const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16)
  const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16)
  return Math.sqrt(Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2))
}

export default function PaletteExtractor() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [dominantPalette, setDominantPalette] = useState<string[]>([])
  const [pickedColors, setPickedColors] = useState<string[]>([])
  
  const imgRef = useRef<HTMLImageElement>(null)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // --- 1. ACCURATE DOMINANT COLOR EXTRACTION ---
  const extractColors = () => {
    if (!imgRef.current) return
    const img = imgRef.current
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // Scale to a reasonable size for processing speed while maintaining detail
    canvas.width = 150
    canvas.height = 150
    ctx.drawImage(img, 0, 0, 150, 150)
    const data = ctx.getImageData(0, 0, 150, 150).data
    
    const colorCounts: Record<string, number> = {}
    
    // Step 1: Count frequency of slightly rounded colors
    for (let i = 0; i < data.length; i += 4) { 
      if (data[i+3] < 125) continue // Skip transparent pixels
      
      const r = Math.round(data[i] / 10) * 10
      const g = Math.round(data[i+1] / 10) * 10
      const b = Math.round(data[i+2] / 10) * 10
      const hex = rgbToHex(r, g, b)
      colorCounts[hex] = (colorCounts[hex] || 0) + 1
    }
    
    const sortedHexes = Object.keys(colorCounts).sort((a, b) => colorCounts[b] - colorCounts[a])
    
    // Step 2: Filter by Euclidean distance to ensure 6 distinct colors
    const distinctColors: string[] = []
    const DISTANCE_THRESHOLD = 45 

    for (const hex of sortedHexes) {
      let isDistinct = true
      for (const dHex of distinctColors) {
        if (colorDistance(hex, dHex) < DISTANCE_THRESHOLD) {
          isDistinct = false
          break
        }
      }
      if (isDistinct) {
        distinctColors.push(hex)
      }
      if (distinctColors.length === 6) break
    }
    
    setDominantPalette(distinctColors)

    // Setup an offscreen canvas in actual resolution for the Color Picker
    const offCanvas = document.createElement('canvas')
    offCanvas.width = img.naturalWidth
    offCanvas.height = img.naturalHeight
    const offCtx = offCanvas.getContext('2d')
    if (offCtx) {
      offCtx.drawImage(img, 0, 0)
      offscreenCanvasRef.current = offCanvas
    }
  }

  // --- 2. COLOR PICKER (EYEDROPPER) LOGIC ---
  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current || !offscreenCanvasRef.current) return
    
    const img = imgRef.current
    const rect = img.getBoundingClientRect()
    
    // Calculate the actual rendered dimensions within the object-contain bounds
    const imgRatio = img.naturalWidth / img.naturalHeight
    const boxRatio = rect.width / rect.height
    let renderedWidth, renderedHeight, offsetX = 0, offsetY = 0

    if (imgRatio > boxRatio) {
      renderedWidth = rect.width
      renderedHeight = rect.width / imgRatio
      offsetY = (rect.height - renderedHeight) / 2
    } else {
      renderedHeight = rect.height
      renderedWidth = rect.height * imgRatio
      offsetX = (rect.width - renderedWidth) / 2
    }

    const clickX = e.clientX - rect.left - offsetX
    const clickY = e.clientY - rect.top - offsetY

    // Ensure the click was actually on the image, not the letterboxed empty space
    if (clickX < 0 || clickX > renderedWidth || clickY < 0 || clickY > renderedHeight) return

    // Map the click back to the natural image resolution
    const naturalX = Math.floor(clickX * (img.naturalWidth / renderedWidth))
    const naturalY = Math.floor(clickY * (img.naturalHeight / renderedHeight))

    // Extract exact pixel color
    const offCtx = offscreenCanvasRef.current.getContext('2d')
    if (offCtx) {
      const pixel = offCtx.getImageData(naturalX, naturalY, 1, 1).data
      const hex = rgbToHex(pixel[0], pixel[1], pixel[2])
      
      // Prevent duplicate adjacent picks
      if (!pickedColors.includes(hex)) {
        setPickedColors(prev => [hex, ...prev].slice(0, 6)) // Keep last 6 picked
      }
    }
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setImageSrc(URL.createObjectURL(acceptedFiles[0]))
      setDominantPalette([])
      setPickedColors([])
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'image/*': [] }, maxFiles: 1
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row h-[650px]">
      
      {/* Sidebar Workspace */}
      <div className="w-full md:w-80 h-full bg-slate-50 p-6 border-r border-slate-200 flex flex-col gap-6 overflow-y-auto">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest border-b pb-4 flex items-center gap-2 flex-shrink-0">
          <Palette className="w-4 h-4"/> Color Data
        </h3>
        
        {dominantPalette.length > 0 ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            
            {/* Picked Colors Section */}
            {pickedColors.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold text-[#6384A3] uppercase tracking-widest mb-2 flex items-center gap-1">
                  <Pipette className="w-3 h-3" /> Selected Colors
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {pickedColors.map((hex, i) => (
                    <div key={`picked-${i}`} className="flex flex-col gap-1">
                      <div className="h-8 w-full rounded border border-slate-200 shadow-sm" style={{ backgroundColor: hex }} />
                      <button 
                        onClick={() => { navigator.clipboard.writeText(hex.toUpperCase()); alert(`Copied ${hex.toUpperCase()}`) }}
                        className="flex items-center justify-between px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        {hex.toUpperCase()} <Copy className="w-3 h-3 text-slate-400" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dominant Palette Section */}
            <div className={pickedColors.length > 0 ? "pt-4 border-t border-slate-200" : ""}>
              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Dominant Palette</h4>
              <div className="grid grid-cols-2 gap-3">
                {dominantPalette.map((hex, i) => (
                  <div key={`dominant-${i}`} className="flex flex-col gap-1">
                    <div className="h-12 w-full rounded border border-slate-200 shadow-sm" style={{ backgroundColor: hex }} />
                    <button 
                      onClick={() => { navigator.clipboard.writeText(hex.toUpperCase()); alert(`Copied ${hex.toUpperCase()}`) }}
                      className="flex items-center justify-between px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      {hex.toUpperCase()} <Copy className="w-3 h-3 text-slate-400" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

          </div>
        ) : (
          <p className="text-xs text-slate-500 text-center mt-10">Upload an image to extract its color palette.</p>
        )}
      </div>

      {/* Main Image Area */}
      <div className="flex-1 p-6 md:p-8 relative h-full flex flex-col">
        {!imageSrc ? (
          <div {...getRootProps()} className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-slate-100/50'}`}>
            <input {...getInputProps()} />
            <ImageIcon className={`w-12 h-12 mb-4 ${isDragActive ? 'text-[#6384A3]' : 'text-slate-300'}`} />
            <h3 className="text-lg font-bold text-slate-700 mb-1">Drop Image to Analyze</h3>
          </div>
        ) : (
          <div className="flex-1 bg-slate-100 rounded-lg p-4 flex items-center justify-center relative overflow-hidden group">
            <button 
              onClick={() => { setImageSrc(null); setDominantPalette([]); setPickedColors([]); }} 
              className="absolute top-3 right-3 z-50 bg-white/90 text-slate-800 p-2 rounded-full shadow-md hover:bg-red-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            {/* Instructions Overlay */}
            <div className="absolute top-3 left-4 bg-white/90 px-3 py-1.5 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none flex items-center gap-2">
              <Pipette className="w-4 h-4 text-[#6384A3]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">Click anywhere to pick color</span>
            </div>

            <img 
              ref={imgRef} 
              src={imageSrc} 
              alt="Preview" 
              onLoad={extractColors} 
              onClick={handleImageClick}
              className="w-full h-full object-contain drop-shadow-md cursor-crosshair active:scale-[0.99] transition-transform" 
            />
          </div>
        )}
      </div>
    </div>
  )
}