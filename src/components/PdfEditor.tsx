'use client'

import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { jsPDF } from 'jspdf'
import * as pdfjsLib from 'pdfjs-dist'
import JSZip from 'jszip'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Settings2, Trash2, Eye, Download, RotateCw, Lock, Unlock, FileText, Type, SlidersHorizontal, X, FileImage, ShieldCheck } from 'lucide-react'
import CustomDropdown from './CustomDropdown'

// --- SORTABLE GRID ITEM ---
interface SortableItemProps {
  id: string
  url: string
  index: number
  rotation: number
  onRemove: (id: string) => void
  onRotate: (id: string) => void
}

function SortablePageItem({ id, url, index, rotation, onRemove, onRotate }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Scale down rotated items slightly in the UI so they don't overflow the 3/4 aspect ratio box
  const isRotated = rotation % 180 !== 0
  const imageScale = isRotated ? 0.75 : 1

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners} 
      className="relative rounded-lg overflow-hidden border border-slate-200 aspect-[3/4] cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow bg-slate-100 flex items-center justify-center group"
    >
      <div className="w-full h-full flex items-center justify-center">
        <img 
          src={url} 
          alt={`Page ${index + 1}`} 
          className="max-w-full max-h-full object-contain pointer-events-none transition-transform" 
          style={{ transform: `rotate(${rotation}deg) scale(${imageScale})` }}
        />
      </div>
      
      {/* Action Buttons Overlay */}
      <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onRemove(id) }}
          className="bg-red-500/90 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-md transition-colors"
          title="Delete Page"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onRotate(id) }}
          className="bg-slate-800/90 hover:bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-md transition-colors"
          title="Rotate 90°"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded font-bold shadow-sm">
        {index + 1}
      </div>
    </div>
  )
}

// --- MAIN COMPONENT ---
type PageItem = { id: string; url: string; isLossless: boolean; rotation: number }

export default function PdfEditor() {
  const [pages, setPages] = useState<PageItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Accordion State
  const [activePanel, setActivePanel] = useState<'security' | 'watermark' | 'compression' | null>(null)

  // Document Settings
  const [unlockPassword, setUnlockPassword] = useState('')
  const [encryptPassword, setEncryptPassword] = useState('')
  
  // Watermark Settings
  const [watermarkText, setWatermarkText] = useState('')
  const [watermarkPlacement, setWatermarkPlacement] = useState('center')
  const [watermarkOpacity, setWatermarkOpacity] = useState(30)
  
  // Compression Settings
  const [enableCompression, setEnableCompression] = useState(false)
  const [compressionQuality, setCompressionQuality] = useState(70)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    if (typeof window !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
    }
  }, [])

  // --- FILE HANDLING LOGIC ---
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    setIsProcessing(true)
    
    try {
      const newPages: PageItem[] = []

      for (const file of acceptedFiles) {
        if (file.type === 'application/pdf') {
          setLoadingText('Extracting PDF pages...')
          const arrayBuffer = await file.arrayBuffer()
          
          let pdf;
          try {
            pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password: unlockPassword }).promise
          } catch (e: any) {
            if (e.name === 'PasswordException') {
              alert("This PDF is password protected. Please enter the password in the 'Unlock' field and try again.")
              continue
            }
            throw e
          }
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const viewport = page.getViewport({ scale: 2.0 })
            const canvas = document.createElement('canvas')
            const context = canvas.getContext('2d')
            if (!context) continue

            canvas.height = viewport.height
            canvas.width = viewport.width

            // Bypass volatile pdfjs-dist TypeScript definitions with as any
            await page.render({ canvasContext: context, viewport } as any).promise
            
            newPages.push({
              id: `pdf-page-${Date.now()}-${Math.random()}`,
              url: canvas.toDataURL('image/png'),
              isLossless: true,
              rotation: 0
            })
          }
        } else if (file.type.startsWith('image/')) {
          setLoadingText('Adding images...')
          newPages.push({
            id: `image-${file.name}-${Date.now()}`,
            url: URL.createObjectURL(file),
            isLossless: file.type === 'image/png' || file.type === 'image/webp',
            rotation: 0
          })
        }
      }

      setPages(prev => [...prev, ...newPages])
      setUnlockPassword('') // Clear after successful use
    } catch (error) {
      alert("Failed to process the file.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }, [unlockPassword])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] }
  })

  // --- GRID ACTIONS ---
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setPages((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  const removePage = (idToRemove: string) => setPages(items => items.filter(item => item.id !== idToRemove))
  const rotatePage = (idToRotate: string) => {
    setPages(items => items.map(item => item.id === idToRotate ? { ...item, rotation: (item.rotation + 90) % 360 } : item))
  }
  const clearAll = () => setPages([])

  // --- PDF GENERATION ENGINE ---
  const generatePdfBlob = async (): Promise<Blob | null> => {
    if (pages.length === 0) return null

    let pdf: jsPDF | null = null;
    
    for (let i = 0; i < pages.length; i++) {
      const { url, rotation } = pages[i]
      
      const img = new Image()
      img.src = url
      await new Promise((resolve) => { img.onload = resolve })

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) continue

      // True Rotation: Swap dimensions if rotated 90 or 270 degrees
      const isRotated = rotation % 180 !== 0
      canvas.width = isRotated ? img.height : img.width
      canvas.height = isRotated ? img.width : img.height

      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      
      // Apply Watermark
      if (watermarkText) {
        const fontSize = Math.max(Math.floor(canvas.width / 15), 20)
        ctx.font = `bold ${fontSize}px sans-serif`
        ctx.fillStyle = `rgba(150, 150, 150, ${watermarkOpacity / 100})`

        let x = canvas.width / 2
        let y = canvas.height / 2
        let align: CanvasTextAlign = 'center'
        let baseline: CanvasTextBaseline = 'middle'
        let angle = -Math.PI / 4

        const padding = fontSize

        if (watermarkPlacement === 'top-left') {
          x = padding; y = padding; align = 'left'; baseline = 'top'; angle = 0;
        } else if (watermarkPlacement === 'top-right') {
          x = canvas.width - padding; y = padding; align = 'right'; baseline = 'top'; angle = 0;
        } else if (watermarkPlacement === 'bottom-left') {
          x = padding; y = canvas.height - padding; align = 'left'; baseline = 'bottom'; angle = 0;
        } else if (watermarkPlacement === 'bottom-right') {
          x = canvas.width - padding; y = canvas.height - padding; align = 'right'; baseline = 'bottom'; angle = 0;
        }

        ctx.translate(x, y)
        ctx.rotate(angle)
        ctx.textAlign = align
        ctx.textBaseline = baseline
        ctx.fillText(watermarkText, 0, 0)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }

      const orientation = canvas.width > canvas.height ? 'l' : 'p'
      
      if (i === 0) {
        const pdfOptions: any = { orientation, unit: 'px', format: [canvas.width, canvas.height] }
        if (encryptPassword) {
          pdfOptions.encryption = { userPassword: encryptPassword, ownerPassword: encryptPassword, userPermissions: ["print", "modify"] }
        }
        pdf = new jsPDF(pdfOptions)
      } else {
        pdf!.addPage([canvas.width, canvas.height], orientation)
      }

      // If compression isn't explicitly enabled, default to a visually lossless but highly compressed JPEG (0.92)
      const outputQuality = enableCompression ? (compressionQuality / 100) : 0.92
      const processedData = canvas.toDataURL('image/jpeg', outputQuality)
      pdf!.addImage(processedData, 'JPEG', 0, 0, canvas.width, canvas.height)
    }
    
    return pdf ? pdf.output('blob') : null
  }

  // --- ACTIONS ---
  const handlePreview = async () => {
    setIsProcessing(true)
    setLoadingText('Generating Preview...')
    try {
      const blob = await generatePdfBlob()
      if (blob) setPreviewUrl(URL.createObjectURL(blob))
    } catch (e) {
      alert("Failed to generate preview.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const exportAsPdf = async () => {
    setIsProcessing(true)
    setLoadingText('Saving Document...')
    try {
      const blob = await generatePdfBlob()
      if (blob) {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `zsconverter-document-${Date.now()}.pdf`
        link.click()
      }
    } catch (e) {
      alert("Failed to save PDF.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const exportAsImages = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setLoadingText('Zipping images...')
    try {
      const zip = new JSZip()
      for (let i = 0; i < pages.length; i++) {
        const response = await fetch(pages[i].url)
        const blob = await response.blob()
        zip.file(`page-${String(i + 1).padStart(3, '0')}.png`, blob)
      }
      const zipContent = await zip.generateAsync({ type: 'blob' })
      const downloadUrl = URL.createObjectURL(zipContent)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `zsconverter-extracted-pages-${Date.now()}.zip`
      link.click()
    } catch (error) {
      alert("Failed to export images.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row h-[650px]">
        
        {/* Sidebar Settings */}
        <div className="w-full md:w-80 h-full flex flex-col gap-4 overflow-y-auto pr-2 pb-2 p-6 bg-slate-50 border-r border-slate-200">
          <div className="flex justify-between items-center border-b border-slate-200 pb-2 flex-shrink-0">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Doc Settings
            </h4>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto pr-1">
            
            {/* Security Accordion */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white shadow-sm">
              <button onClick={() => setActivePanel(activePanel === 'security' ? null : 'security')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
                <ShieldCheck className="w-4 h-4 text-[#6384A3]" /> Security & Passwords
              </button>
              {activePanel === 'security' && (
                <div className="p-4 space-y-4 border-t border-slate-100">
                  <div className="space-y-2">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      <Unlock className="w-3 h-3" /> Unlock PDF
                    </label>
                    <input type="password" placeholder="Required for locked PDFs" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" />
                  </div>
                  <div className="space-y-2 pt-2 border-t border-slate-50">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      <Lock className="w-3 h-3" /> Encrypt Output
                    </label>
                    <input type="password" placeholder="Set a new password (optional)" value={encryptPassword} onChange={(e) => setEncryptPassword(e.target.value)} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" />
                  </div>
                </div>
              )}
            </div>

            {/* Watermark Accordion */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white shadow-sm">
              <button onClick={() => setActivePanel(activePanel === 'watermark' ? null : 'watermark')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
                <Type className="w-4 h-4 text-[#6384A3]" /> Watermark
              </button>
              {activePanel === 'watermark' && (
                <div className="p-4 space-y-4 border-t border-slate-100">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Text</label>
                    <input type="text" placeholder="e.g. CONFIDENTIAL" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Placement</label>
                    <CustomDropdown 
                      value={watermarkPlacement} 
                      onChange={setWatermarkPlacement} 
                      options={[
                        { value: 'center', label: 'Diagonal Center' },
                        { value: 'top-left', label: 'Top Left' },
                        { value: 'top-right', label: 'Top Right' },
                        { value: 'bottom-left', label: 'Bottom Left' },
                        { value: 'bottom-right', label: 'Bottom Right' }
                      ]} 
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      <span>Opacity</span>
                      <span className="text-[#6384A3]">{watermarkOpacity}%</span>
                    </div>
                    <input type="range" min="10" max="100" value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(Number(e.target.value))} className="w-full accent-[#6384A3]" />
                  </div>
                </div>
              )}
            </div>

            {/* Compression Accordion */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white shadow-sm">
              <button onClick={() => setActivePanel(activePanel === 'compression' ? null : 'compression')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
                <SlidersHorizontal className="w-4 h-4 text-[#6384A3]" /> Doc Compression
              </button>
              {activePanel === 'compression' && (
                <div className="p-4 space-y-4 border-t border-slate-100">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider cursor-pointer">
                    <input type="checkbox" checked={enableCompression} onChange={(e) => setEnableCompression(e.target.checked)} className="w-4 h-4 accent-[#6384A3] rounded" />
                    Force File Shrink
                  </label>
                  {enableCompression ? (
                    <div className="space-y-2 animate-in fade-in">
                      <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        <span>Quality</span>
                        <span className="text-[#6384A3]">{compressionQuality}%</span>
                      </div>
                      <input type="range" min="10" max="100" value={compressionQuality} onChange={(e) => setCompressionQuality(Number(e.target.value))} className="w-full accent-[#6384A3]" />
                      <p className="text-[9px] text-slate-400">Lowering quality drastically reduces file size.</p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500">Currently exporting visually lossless JPEGs for optimal quality/size balance.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Export Actions */}
          <div className="mt-auto pt-4 border-t border-slate-200 flex-shrink-0 space-y-3">
            <button onClick={handlePreview} disabled={isProcessing || pages.length === 0} className="w-full py-2.5 border border-slate-200 bg-white text-slate-700 font-bold text-xs uppercase tracking-widest rounded-lg hover:bg-slate-100 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm">
              <Eye className="w-4 h-4" /> Preview Doc
            </button>
            <div className="flex gap-2">
              <button onClick={exportAsImages} disabled={isProcessing || pages.length === 0} className="flex-1 py-3 bg-slate-800 text-white font-bold text-xs uppercase tracking-widest rounded-lg hover:bg-black disabled:opacity-50 transition-colors shadow-sm" title="Export as Image ZIP">
                <FileImage className="w-4 h-4 mx-auto" />
              </button>
              <button onClick={exportAsPdf} disabled={isProcessing || pages.length === 0} className="flex-[3] py-3 bg-[#6384A3] text-white font-bold text-xs uppercase tracking-widest rounded-lg hover:bg-[#4f6a83] disabled:opacity-50 shadow-md transition-colors flex items-center justify-center gap-2">
                <FileText className="w-4 h-4" /> Save PDF
              </button>
            </div>
          </div>
        </div>

        {/* Main Grid Area */}
        <div className="flex-1 p-6 md:p-8 bg-white flex flex-col relative h-full">
          <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-2 flex-shrink-0">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              {pages.length} {pages.length === 1 ? 'Page' : 'Pages'} Loaded
            </span>
            {pages.length > 0 && !isProcessing && (
              <button onClick={clearAll} className="text-[10px] font-bold text-red-500 hover:text-red-700 uppercase tracking-widest transition-colors flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Clear All
              </button>
            )}
          </div>

          {pages.length === 0 ? (
            <div {...getRootProps()} className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl cursor-pointer transition-colors ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-200 hover:border-[#6384A3] hover:bg-slate-50'}`}>
              <input {...getInputProps()} />
              <FileText className="w-12 h-12 mb-4 text-slate-300" />
              <p className="text-sm font-bold text-slate-700">Drag & drop PDFs or Images here</p>
              <p className="text-xs text-slate-500 mt-1">or click to browse</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pr-2">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pages.map(p => p.id)} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 pb-6">
                    {pages.map((page, index) => (
                      <SortablePageItem 
                        key={page.id} 
                        id={page.id} 
                        url={page.url} 
                        index={index}
                        rotation={page.rotation}
                        onRemove={removePage} 
                        onRotate={rotatePage}
                      />
                    ))}
                    
                    {/* Add More Dropzone Inline */}
                    <div {...getRootProps()} className={`aspect-[3/4] border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors ${isDragActive ? 'border-[#6384A3] bg-blue-50' : 'border-slate-200 hover:border-[#6384A3] hover:bg-slate-50'}`}>
                      <input {...getInputProps()} />
                      <span className="text-2xl text-slate-400 font-light">+</span>
                    </div>
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {isProcessing && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50 rounded-xl">
              <svg className="animate-spin w-8 h-8 text-[#6384A3] mb-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-xs font-bold text-slate-800 uppercase tracking-widest">{loadingText}</p>
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-[120] bg-slate-900/95 flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="flex justify-between items-center p-4 bg-slate-900 border-b border-slate-800 flex-shrink-0 shadow-lg">
            <h3 className="text-white font-bold text-sm uppercase tracking-widest flex items-center gap-2">
              <Eye className="w-4 h-4" /> Document Preview
            </h3>
            <button onClick={() => setPreviewUrl(null)} className="text-slate-400 hover:text-white transition-colors bg-slate-800 p-2 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 p-4 md:p-8 flex justify-center">
            <iframe src={previewUrl} className="w-full max-w-4xl h-full rounded shadow-2xl bg-white" title="PDF Preview" />
          </div>
        </div>
      )}
    </>
  )
}