'use client'

import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Settings2, Trash2, Eye, Download, RotateCw, Lock, Unlock, FileText, Type, SlidersHorizontal, X, FileImage, ShieldCheck, Layers, Scissors, Wand2, Hash, Edit3 } from 'lucide-react'
import CustomDropdown from './CustomDropdown'

// --- SORTABLE GRID ITEM ---
interface SortableItemProps {
  id: string
  url: string
  index: number
  rotation: number
  fineRotation: number
  scale: number
  onRemove: (id: string) => void
  onRotate: (id: string) => void
  onEdit: (id: string) => void
}

function SortablePageItem({ id, url, index, rotation, fineRotation, scale, onRemove, onRotate, onEdit }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

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
      <div className="w-full h-full flex items-center justify-center overflow-hidden bg-white">
        <img 
          src={url} 
          alt={`Page ${index + 1}`} 
          className="max-w-full max-h-full object-contain pointer-events-none transition-transform" 
          style={{ transform: `rotate(${rotation + fineRotation}deg) scale(${imageScale * scale})` }}
        />
      </div>
      
      <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity z-10">
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onRemove(id) }}
          className="bg-red-500/90 hover:bg-red-600 text-white rounded-full w-7 h-7 lg:w-6 lg:h-6 flex items-center justify-center shadow-md transition-colors"
          title="Delete Page"
        >
          <X className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
        </button>
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onRotate(id) }}
          className="bg-slate-800/90 hover:bg-black text-white rounded-full w-7 h-7 lg:w-6 lg:h-6 flex items-center justify-center shadow-md transition-colors"
          title="Rotate 90°"
        >
          <RotateCw className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
        </button>
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onEdit(id) }}
          className="bg-[#6384A3]/90 hover:bg-[#4f6a83] text-white rounded-full w-7 h-7 lg:w-6 lg:h-6 flex items-center justify-center shadow-md transition-colors"
          title="Straighten & Crop Page"
        >
          <Edit3 className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
        </button>
      </div>

      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded font-bold shadow-sm flex items-center gap-1">
        {index + 1}
        {(fineRotation !== 0 || scale !== 1) && <span className="text-[#6384A3] ml-1">Edited</span>}
      </div>
    </div>
  )
}

// --- MAIN COMPONENT ---
type PageItem = { id: string; url: string; isLossless: boolean; rotation: number; fineRotation: number; scale: number }

export default function PdfEditor() {
  const [pages, setPages] = useState<PageItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  
  const [originalDocName, setOriginalDocName] = useState('document')

  // Expanded Accordion State
  const [activePanel, setActivePanel] = useState<'security' | 'overlays' | 'compression' | 'merge' | 'split' | 'enhance' | null>(null)

  const [unlockPassword, setUnlockPassword] = useState('')
  const [encryptPassword, setEncryptPassword] = useState('')
  
  const [watermarkText, setWatermarkText] = useState('')
  const [watermarkPlacement, setWatermarkPlacement] = useState('center')
  const [watermarkOpacity, setWatermarkOpacity] = useState(30)
  const [addPageNumbers, setAddPageNumbers] = useState(false)
  
  const [enableCompression, setEnableCompression] = useState(false)
  const [compressionQuality, setCompressionQuality] = useState(70)

  const [cleanWatermarks, setCleanWatermarks] = useState(false)
  const [splitRanges, setSplitRanges] = useState('')

  const [exportFormat, setExportFormat] = useState('pdf')

  // Straighten & Scale Modal State
  const [editingPageId, setEditingPageId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

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
    setIsProcessing(true)

    if (!originalDocName || originalDocName === 'document') {
      const firstFileName = acceptedFiles[0].name
      const baseName = firstFileName.substring(0, firstFileName.lastIndexOf('.')) || firstFileName
      setOriginalDocName(baseName)
    }
    
    try {
      const newPages: PageItem[] = []

      for (const file of acceptedFiles) {
        if (file.type === 'application/pdf') {
          setLoadingText(`Extracting ${file.name}...`)
          const arrayBuffer = await file.arrayBuffer()
          const pdfjsLib = await import('pdfjs-dist')
          
          let pdf;
          try {
            pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password: unlockPassword }).promise
          } catch (e: any) {
            if (e.name === 'PasswordException') {
              alert(`The file ${file.name} is password protected. Enter the password in the 'Security' tab and try again.`)
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

            await page.render({ canvasContext: context, viewport } as any).promise
            
            newPages.push({
              id: `pdf-page-${Date.now()}-${Math.random()}`,
              url: canvas.toDataURL('image/png'),
              isLossless: true,
              rotation: 0,
              fineRotation: 0,
              scale: 1
            })
          }
        } else if (file.type.startsWith('image/')) {
          setLoadingText('Adding image...')
          newPages.push({
            id: `image-${file.name}-${Date.now()}`,
            url: URL.createObjectURL(file),
            isLossless: file.type === 'image/png' || file.type === 'image/webp',
            rotation: 0,
            fineRotation: 0,
            scale: 1
          })
        }
      }

      setPages(prev => [...prev, ...newPages])
      setUnlockPassword('')
    } catch (error) {
      alert("Failed to process the file. It may be corrupted or highly encrypted.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }, [unlockPassword, originalDocName])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] }
  })

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
  const updateFineRotation = (id: string, deg: number) => {
    setPages(items => items.map(item => item.id === id ? { ...item, fineRotation: deg } : item))
  }
  const updateScale = (id: string, scale: number) => {
    setPages(items => items.map(item => item.id === id ? { ...item, scale: scale } : item))
  }
  const clearAll = () => {
    setPages([])
    setOriginalDocName('document')
  }

  const generatePdfBlob = async (pagesToExport: PageItem[] = pages): Promise<Blob | null> => {
    if (pagesToExport.length === 0) return null

    let pdf: jsPDF | null = null;
    
    for (let i = 0; i < pagesToExport.length; i++) {
      const { url, rotation, fineRotation, scale } = pagesToExport[i]
      
      const img = new Image()
      img.src = url
      await new Promise((resolve) => { img.onload = resolve })

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) continue

      const isRotated = rotation % 180 !== 0
      canvas.width = isRotated ? img.height : img.width
      canvas.height = isRotated ? img.width : img.height

      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(((rotation + fineRotation) * Math.PI) / 180)
      const currentScale = scale || 1
      ctx.scale(currentScale, currentScale)
      ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      
      // Watermark Removal / Clean Scan
      if (cleanWatermarks) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imgData.data
        for (let j = 0; j < data.length; j += 4) {
          const r = data[j], g = data[j+1], b = data[j+2]
          if (r > 160 && g > 160 && b > 160) {
            data[j] = 255; data[j+1] = 255; data[j+2] = 255;
          } 
          else if (r < 100 && g < 100 && b < 100) {
            data[j] = 0; data[j+1] = 0; data[j+2] = 0;
          }
        }
        ctx.putImageData(imgData, 0, 0)
      }

      // Add Page Numbers
      if (addPageNumbers) {
        const fontSize = Math.max(Math.floor(canvas.width / 35), 12)
        ctx.font = `bold ${fontSize}px sans-serif`
        ctx.fillStyle = '#000000'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${i + 1} / ${pagesToExport.length}`, canvas.width / 2, canvas.height - fontSize)
      }

      // Add Watermark
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

      const outputQuality = enableCompression ? (compressionQuality / 100) : 0.92
      const processedData = canvas.toDataURL('image/jpeg', outputQuality)
      pdf!.addImage(processedData, 'JPEG', 0, 0, canvas.width, canvas.height)
    }
    
    return pdf ? pdf.output('blob') : null
  }

  const exportAsWord = async () => {
    setIsProcessing(true)
    setLoadingText('Building Word Document...')
    try {
      let htmlContent = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Exported Doc</title></head><body>`
      
      for (let i = 0; i < pages.length; i++) {
        const { url, rotation, fineRotation, scale } = pages[i]
        const img = await createImage(url)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) continue

        canvas.width = img.width; canvas.height = img.height
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.translate(canvas.width/2, canvas.height/2)
        ctx.rotate(((rotation + fineRotation) * Math.PI) / 180)
        const currentScale = scale || 1
        ctx.scale(currentScale, currentScale)
        ctx.drawImage(img, -img.width/2, -img.height/2, img.width, img.height)
        
        const b64 = canvas.toDataURL('image/jpeg', 0.85)
        htmlContent += `<img src="${b64}" style="width:100%; max-width:800px; page-break-after:always; display:block; margin-bottom:20px;" />`
      }
      
      htmlContent += `</body></html>`
      
      const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${originalDocName}_zs_converter.doc`
      link.click()
    } catch(e) {
      alert("Word export failed.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const handleSplitPdf = async () => {
    if (!splitRanges.trim()) return alert("Please enter valid page ranges (e.g., 1-3, 5).")
    
    setIsProcessing(true)
    setLoadingText('Splitting PDF...')
    try {
      const ranges = splitRanges.split(',').map(r => r.trim())
      const zip = new JSZip()
      
      for (let i = 0; i < ranges.length; i++) {
        const rangeStr = ranges[i]
        const parts = rangeStr.split('-').map(n => parseInt(n, 10))
        let start = 1, end = 1
        
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          start = parts[0]; end = parts[1];
        } else if (parts.length === 1 && !isNaN(parts[0])) {
          start = parts[0]; end = parts[0];
        } else {
          continue;
        }

        start = Math.max(1, Math.min(start, pages.length))
        end = Math.max(1, Math.min(end, pages.length))
        
        const actualStart = Math.min(start, end)
        const actualEnd = Math.max(start, end)
        
        const slice = pages.slice(actualStart - 1, actualEnd)
        if (slice.length > 0) {
          const splitBlob = await generatePdfBlob(slice)
          if (splitBlob) {
            zip.file(`${originalDocName}_split_${actualStart}-${actualEnd}.pdf`, splitBlob)
          }
        }
      }
      
      const zipContent = await zip.generateAsync({ type: 'blob' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(zipContent)
      link.download = `${originalDocName}_splits_zs_converter.zip`
      link.click()
    } catch (e) {
      alert("Split operation failed. Please check your range formatting.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const handleMainExport = () => {
    if (exportFormat === 'pdf') {
      exportAsPdf()
    } else if (exportFormat === 'images') {
      exportAsImages()
    } else if (exportFormat === 'word') {
      exportAsWord()
    }
  }

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
        link.download = `${originalDocName}_zs_converter.pdf`
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
      link.download = `${originalDocName}_images_zs_converter.zip`
      link.click()
    } catch (error) {
      alert("Failed to export images.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const editingPageData = editingPageId ? pages.find(p => p.id === editingPageId) : null

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px]">
        
        {/* Sidebar Settings */}
        <div className="w-full lg:w-80 h-auto lg:h-full flex flex-col gap-4 overflow-y-auto p-4 lg:p-6 bg-slate-50 border-b lg:border-b-0 lg:border-r border-slate-200 order-2 lg:order-1">
          <div className="flex justify-between items-center border-b border-slate-200 pb-2 flex-shrink-0">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Doc Settings
            </h4>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto pr-1 pb-4">
            
            {/* Merge Accordion */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white shadow-sm">
              <button onClick={() => setActivePanel(activePanel === 'merge' ? null : 'merge')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
                <Layers className="w-4 h-4 text-[#6384A3]" /> Merge Documents
              </button>
              {activePanel === 'merge' && (
                <div className="p-4 space-y-4 border-t border-slate-100">
                  <p className="text-xs text-slate-500">Upload multiple PDFs or images to seamlessly append them to your current document.</p>
                  <button 
                    onClick={() => document.getElementById('merge-file-upload')?.click()} 
                    className="w-full py-2.5 bg-white border-2 border-dashed border-slate-300 text-slate-600 hover:border-[#6384A3] hover:text-[#6384A3] font-bold text-xs uppercase tracking-widest rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    + Add Files to Merge
                  </button>
                  <input type="file" id="merge-file-upload" multiple accept=".pdf,image/jpeg,image/png,image/webp" className="hidden" 
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        onDrop(Array.from(e.target.files));
                        e.target.value = '';
                      }
                    }} 
                  />
                </div>
              )}
            </div>

            {/* Split Accordion */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white shadow-sm">
              <button onClick={() => setActivePanel(activePanel === 'split' ? null : 'split')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
                <Scissors className="w-4 h-4 text-[#6384A3]" /> Split Document
              </button>
              {activePanel === 'split' && (
                <div className="p-4 space-y-4 border-t border-slate-100">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Ranges to extract (e.g. 1-2, 5, 8-10)</p>
                  <input type="text" placeholder="1-3, 5-6" value={splitRanges} onChange={(e) => setSplitRanges(e.target.value)} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" />
                  <button onClick={handleSplitPdf} disabled={isProcessing || pages.length === 0} className="w-full py-2 bg-slate-800 text-white font-bold text-[10px] uppercase tracking-widest rounded-lg hover:bg-black transition-colors shadow-sm">
                    Download Split ZIP
                  </button>
                </div>
              )}
            </div>

            {/* Enhance & Clean Accordion */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white shadow-sm">
              <button onClick={() => setActivePanel(activePanel === 'enhance' ? null : 'enhance')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
                <Wand2 className="w-4 h-4 text-[#6384A3]" /> Scan Cleaner
              </button>
              {activePanel === 'enhance' && (
                <div className="p-4 space-y-4 border-t border-slate-100">
                  <label className="flex items-start gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={cleanWatermarks} onChange={(e) => setCleanWatermarks(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[#6384A3] rounded" />
                    <div>
                      <span className="uppercase tracking-wider">Remove Faint Watermarks</span>
                      <p className="text-[9px] text-slate-400 font-normal mt-1 leading-tight">Washes out light colors, shadows, and faint watermarks while preserving dark text for scanned documents.</p>
                    </div>
                  </label>
                </div>
              )}
            </div>

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

            {/* Overlays Accordion */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex-shrink-0 bg-white shadow-sm">
              <button onClick={() => setActivePanel(activePanel === 'overlays' ? null : 'overlays')} className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors">
                <Type className="w-4 h-4 text-[#6384A3]" /> Text Overlays
              </button>
              {activePanel === 'overlays' && (
                <div className="p-4 space-y-4 border-t border-slate-100">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider cursor-pointer border-b border-slate-100 pb-3">
                    <input type="checkbox" checked={addPageNumbers} onChange={(e) => setAddPageNumbers(e.target.checked)} className="w-4 h-4 accent-[#6384A3] rounded" />
                    <Hash className="w-3 h-3 text-[#6384A3]" /> Stamp Page Numbers
                  </label>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Add Watermark Text</label>
                    <input type="text" placeholder="e.g. CONFIDENTIAL" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Watermark Placement</label>
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
            
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Main Export Format</label>
              <CustomDropdown 
                value={exportFormat} 
                onChange={setExportFormat} 
                direction="up"
                options={[
                  { value: 'pdf', label: 'PDF Document (.pdf)' },
                  { value: 'word', label: 'Word Document (.doc)' },
                  { value: 'images', label: 'Image Archive (.zip)' },
                ]} 
              />
            </div>
            
            <div className="flex gap-2">
              <button onClick={handlePreview} disabled={isProcessing || pages.length === 0} className="flex-[0.5] py-2.5 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 disabled:opacity-50 transition-colors flex items-center justify-center shadow-sm" title="Preview File">
                <Eye className="w-4 h-4" />
              </button>
              <button onClick={handleMainExport} disabled={isProcessing || pages.length === 0} className="flex-1 py-2.5 bg-[#6384A3] text-white font-bold text-xs uppercase tracking-widest rounded-lg hover:bg-[#4f6a83] disabled:opacity-50 shadow-md transition-colors flex items-center justify-center gap-2">
                <Download className="w-4 h-4" /> Export File
              </button>
            </div>
          </div>
        </div>

        {/* Main Grid Area */}
        <div className="flex-1 p-4 lg:p-8 bg-white flex flex-col relative min-h-[400px] lg:h-full order-1 lg:order-2">
          <div className="flex justify-between items-center mb-4 lg:mb-6 border-b border-slate-100 pb-2 flex-shrink-0">
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
            <div {...getRootProps()} className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl cursor-pointer transition-colors p-6 text-center ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-200 hover:border-[#6384A3] hover:bg-slate-50'}`}>
              <input {...getInputProps()} />
              <FileText className="w-10 h-10 lg:w-12 lg:h-12 mb-4 text-slate-300" />
              <h3 className="text-sm font-bold text-slate-700">Drag & drop PDFs or Images here</h3>
              <p className="text-xs text-slate-500 mt-1">Pro Tip: Drop multiple files to merge them</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pr-2">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pages.map(p => p.id)} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6 pb-6">
                    {pages.map((page, index) => (
                      <SortablePageItem 
                        key={page.id} 
                        id={page.id} 
                        url={page.url} 
                        index={index}
                        rotation={page.rotation}
                        fineRotation={page.fineRotation || 0}
                        scale={page.scale || 1}
                        onRemove={removePage} 
                        onRotate={rotatePage}
                        onEdit={setEditingPageId}
                      />
                    ))}
                    
                    {/* Add More Dropzone Inline */}
                    <div {...getRootProps()} className={`aspect-[3/4] border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors p-2 text-center ${isDragActive ? 'border-[#6384A3] bg-blue-50' : 'border-slate-200 hover:border-[#6384A3] hover:bg-slate-50'}`}>
                      <input {...getInputProps()} />
                      <span className="text-2xl text-slate-400 font-light mb-1">+</span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Merge PDF</span>
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

      {/* Editing Modal (Fine Straighten & Scale Tool) */}
      {editingPageData && (
        <div className="fixed inset-0 z-[150] bg-slate-900/90 flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#6384A3]" /> Straighten & Crop
              </h3>
              <button onClick={() => setEditingPageId(null)} className="text-slate-400 hover:text-red-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Precision Viewport Canvas */}
            <div className="p-4 sm:p-6 bg-slate-800 flex items-center justify-center relative overflow-hidden" style={{ minHeight: '350px' }}>
              {/* Reference Grid pattern background */}
              <div className="absolute inset-0 pointer-events-none opacity-10" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
              
              {/* Frame Box */}
              <div className="relative inline-block border-2 border-transparent overflow-visible shadow-2xl">
                
                {/* 1. Base Hidden Image - Dictates the Aspect Ratio of the PDF Page frame */}
                <img src={editingPageData.url} className="max-h-[40vh] sm:max-h-[45vh] opacity-0 pointer-events-none" alt="" />
                
                {/* 2. The Transformed Image Layer */}
                <div className="absolute inset-0 flex items-center justify-center overflow-visible">
                   <img 
                     src={editingPageData.url} 
                     className="w-full h-full object-contain max-w-none max-h-none pointer-events-none" 
                     style={{ transform: `rotate(${editingPageData.rotation + editingPageData.fineRotation}deg) scale(${editingPageData.scale || 1})` }} 
                     alt="Editing preview"
                   />
                </div>

                {/* 3. The Dimmer Mask - Uses extreme CSS Box Shadow to dim anything outside the box */}
                <div className="absolute inset-0 pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] z-10 border border-white/50" />
                
                {/* 4. Crosshair Guides */}
                <div className="absolute inset-0 pointer-events-none border border-[#6384A3] z-20 flex items-center justify-center">
                   <div className="w-full h-px bg-[#6384A3]/50 absolute top-1/2 -translate-y-1/2" />
                   <div className="h-full w-px bg-[#6384A3]/50 absolute left-1/2 -translate-x-1/2" />
                </div>
              </div>
            </div>
            
            <div className="p-6 space-y-5 bg-white border-t border-slate-200">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-600 uppercase tracking-widest">
                  <span>Fine Rotation Angle</span>
                  <span className="text-[#6384A3]">{editingPageData.fineRotation}°</span>
                </div>
                <input 
                  type="range" 
                  min="-45" 
                  max="45" 
                  step="0.5" 
                  value={editingPageData.fineRotation} 
                  onChange={(e) => updateFineRotation(editingPageData.id, Number(e.target.value))} 
                  className="w-full accent-[#6384A3]" 
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-600 uppercase tracking-widest">
                  <span>Zoom / Scale</span>
                  <span className="text-[#6384A3]">{(editingPageData.scale || 1).toFixed(2)}x</span>
                </div>
                <input 
                  type="range" 
                  min="0.5" 
                  max="3" 
                  step="0.05" 
                  value={editingPageData.scale || 1} 
                  onChange={(e) => updateScale(editingPageData.id, Number(e.target.value))} 
                  className="w-full accent-[#6384A3]" 
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button onClick={() => { updateFineRotation(editingPageData.id, 0); updateScale(editingPageData.id, 1); }} className="flex-[0.5] py-2.5 px-4 text-xs font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50 uppercase tracking-widest">Reset</button>
                <button onClick={() => setEditingPageId(null)} className="flex-1 py-2.5 text-xs font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83] uppercase tracking-widest">Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Preview Modal (Light Theme) */}
      {previewUrl && (
        <div className="fixed inset-0 z-[120] bg-slate-100/95 backdrop-blur-sm flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="flex justify-between items-center p-4 bg-white border-b border-slate-200 flex-shrink-0 shadow-sm">
            <h3 className="text-slate-800 font-bold text-sm uppercase tracking-widest flex items-center gap-2">
              <Eye className="w-4 h-4 text-[#6384A3]" /> Document Preview
            </h3>
            <button onClick={() => setPreviewUrl(null)} className="text-slate-500 hover:text-red-500 transition-colors bg-slate-100 p-2 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 p-2 md:p-8 flex justify-center">
            <iframe src={previewUrl} className="w-full max-w-4xl h-full rounded border border-slate-200 shadow-2xl bg-white" title="PDF Preview" />
          </div>
        </div>
      )}
    </>
  )
}