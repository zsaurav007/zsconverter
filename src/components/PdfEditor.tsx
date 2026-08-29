'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import { removeBackground, Config } from '@imgly/background-removal'
import { DndContext, closestCenter, TouchSensor, MouseSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Settings2, Trash2, Eye, Download, RotateCw, Lock, Unlock, FileText, Type, SlidersHorizontal, X, FileImage, ShieldCheck, Layers, Scissors, Wand2, Hash, Edit3, PenTool, Image as ImageIcon, Sparkles, Move, ChevronLeft, ChevronRight, LayoutGrid, ZoomIn, ZoomOut } from 'lucide-react'
import CustomDropdown from './CustomDropdown'

// --- HELPER FUNCTIONS ---
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

// --- SORTABLE GRID ITEM ---
interface SortableItemProps {
  id: string
  url: string
  index: number
  rotation: number
  fineRotation: number
  scale: number
  brightness: number
  contrast: number
  grayscale: boolean
  cleanBackground: boolean
  onRemove: (id: string) => void
  onRotate: (id: string) => void
  onEdit: (id: string) => void
}

function SortablePageItem({ id, url, index, rotation, fineRotation, scale, brightness, contrast, grayscale, cleanBackground, onRemove, onRotate, onEdit }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
  }

  const isRotated = rotation % 180 !== 0
  const imageScale = isRotated ? 0.75 : 1

  const g = grayscale ? 'grayscale(100%)' : ''
  const cleanFx = cleanBackground ? 'contrast(150%) brightness(110%)' : ''
  const filterStyle = `brightness(${brightness}%) contrast(${contrast}%) ${g} ${cleanFx}`.trim()

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners} 
      className={`relative rounded-lg overflow-hidden border ${isDragging ? 'border-[#6384A3] shadow-2xl scale-105' : 'border-slate-200'} aspect-[3/4] cursor-grab active:cursor-grabbing hover:shadow-md transition-all bg-slate-100 flex items-center justify-center group touch-none`}
    >
      <div className="w-full h-full flex items-center justify-center overflow-hidden bg-white">
        <img 
          src={url} 
          alt={`Page ${index + 1}`} 
          className="max-w-full max-h-full object-contain pointer-events-none transition-transform" 
          style={{ transform: `rotate(${rotation + fineRotation}deg) scale(${imageScale * scale})`, filter: filterStyle || 'none' }}
        />
      </div>
      
      <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity z-10">
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onRemove(id) }}
          className="bg-red-500/90 hover:bg-red-600 text-white rounded-full w-8 h-8 lg:w-6 lg:h-6 flex items-center justify-center shadow-md transition-colors"
          title="Delete Page"
        >
          <X className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
        </button>
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onRotate(id) }}
          className="bg-slate-800/90 hover:bg-black text-white rounded-full w-8 h-8 lg:w-6 lg:h-6 flex items-center justify-center shadow-md transition-colors"
          title="Rotate 90°"
        >
          <RotateCw className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
        </button>
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onEdit(id) }}
          className="bg-[#6384A3]/90 hover:bg-[#4f6a83] text-white rounded-full w-8 h-8 lg:w-6 lg:h-6 flex items-center justify-center shadow-md transition-colors"
          title="Edit Page (Enhance & Straighten)"
        >
          <Edit3 className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
        </button>
      </div>

      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded font-bold shadow-sm flex items-center gap-1">
        {index + 1}
        {(fineRotation !== 0 || scale !== 1 || brightness !== 100 || grayscale || cleanBackground) && <span className="text-[#6384A3] ml-1">Edited</span>}
      </div>
    </div>
  )
}

// --- MAIN COMPONENT ---
type PageItem = { 
  id: string; 
  url: string; 
  isLossless: boolean; 
  rotation: number; 
  fineRotation: number; 
  scale: number;
  brightness: number;
  contrast: number;
  grayscale: boolean;
  cleanBackground: boolean;
}

type SigPlacement = { x: number, y: number, scale: number, opacity: number }

type SignatureState = {
  enabled: boolean;
  mode: 'text' | 'image';
  text: string;
  font: string;
  color: string;
  imageUrl: string | null;
  applyMode: 'all' | 'custom';
  customPages: string;
  placements: Record<number, SigPlacement>; 
}

export default function PdfEditor() {
  const [pages, setPages] = useState<PageItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  
  const [originalDocName, setOriginalDocName] = useState('document')

  // Expanded Accordion State
  const [activePanel, setActivePanel] = useState<'security' | 'overlays' | 'compression' | 'merge' | 'split' | 'enhance' | 'signature' | 'export' | null>('export')
  
  // Ref for Smooth Scrolling Focus
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (activePanel && panelRefs.current[activePanel]) {
      setTimeout(() => {
        panelRefs.current[activePanel]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 150)
    }
  }, [activePanel])

  const [unlockPassword, setUnlockPassword] = useState('')
  const [encryptPassword, setEncryptPassword] = useState('')
  
  const [watermarkText, setWatermarkText] = useState('')
  const [watermarkPlacement, setWatermarkPlacement] = useState('center')
  const [watermarkOpacity, setWatermarkOpacity] = useState(30)
  const [addPageNumbers, setAddPageNumbers] = useState(false)
  
  // Signature State
  const [signature, setSignature] = useState<SignatureState>({
    enabled: false,
    mode: 'text',
    text: 'John Doe',
    font: 'Brush Script MT, cursive',
    color: '#000033',
    imageUrl: null,
    applyMode: 'all',
    customPages: '',
    placements: {}
  })
  
  const [sigBgModel, setSigBgModel] = useState('briaai/RMBG-1.4')

  const [showSigModal, setShowSigModal] = useState(false)
  const [isDraggingSig, setIsDraggingSig] = useState(false)
  const [draggingContext, setDraggingContext] = useState<'right' | 'modal' | null>(null)
  const [resizingState, setResizingState] = useState<{ startX: number, startY: number, startScale: number, corner: string } | null>(null)
  
  const [previewPageIndex, setPreviewPageIndex] = useState(0)
  const [showViewerGrid, setShowViewerGrid] = useState(false)
  const [sigZoom, setSigZoom] = useState(1)

  // Live Signature Pre-Render State
  const [sigPreviewUrl, setSigPreviewUrl] = useState<string | null>(null)
  const [isGeneratingSigPreview, setIsGeneratingSigPreview] = useState(false)

  const rightSideSigRef = useRef<HTMLDivElement>(null)
  const modalSigRef = useRef<HTMLDivElement>(null)

  // Compression & Export State
  const [enableCompression, setEnableCompression] = useState(false)
  const [compressionQuality, setCompressionQuality] = useState(70)
  const [ppiMode, setPpiMode] = useState<string>('150')
  const [customPPI, setCustomPPI] = useState<number>(150)
  const [compressionGrayscale, setCompressionGrayscale] = useState(false)

  const [cleanWatermarks, setCleanWatermarks] = useState(false)
  const [splitRanges, setSplitRanges] = useState('')

  const [exportFormat, setExportFormat] = useState('pdf')

  // Straighten, Scale & Enhance Modal State
  const [editingPageId, setEditingPageId] = useState<string | null>(null)

  // -- GUARANTEED SAFE DERIVED STATES AT TOP LEVEL --
  const editingPageData = editingPageId ? pages.find(p => p.id === editingPageId) : null
  const sigPageTarget = pages.length > 0 ? (pages[previewPageIndex] || pages[0]) : null

  // Advanced Mobile-Friendly Sensors
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

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

  useEffect(() => {
    if (previewPageIndex >= pages.length && pages.length > 0) {
      setPreviewPageIndex(pages.length - 1)
    }
  }, [pages.length, previewPageIndex])

  // --- SIGNATURE PRE-RENDER LOGIC ---
  useEffect(() => {
    let isMounted = true;
    if ((showSigModal || activePanel === 'signature') && pages.length > 0) {
      const target = pages[previewPageIndex];
      if (target) {
        setIsGeneratingSigPreview(true);
        // Render the page WITH all local enhancements, but WITHOUT the signature
        renderPageToCanvas(target, previewPageIndex, false, true).then(canvas => {
          if (canvas && isMounted) {
            setSigPreviewUrl(canvas.toDataURL('image/jpeg', 0.85));
          }
          if (isMounted) setIsGeneratingSigPreview(false);
        });
      }
    }
    return () => { isMounted = false; }
  }, [showSigModal, activePanel, previewPageIndex, pages, cleanWatermarks, enableCompression, compressionGrayscale]);

  // --- SIGNATURE HELPERS ---
  const getSigPlacement = useCallback((index: number) => {
    return signature.placements[index] || { x: 50, y: 80, scale: 50, opacity: 100 }
  }, [signature.placements])

  const updateSigPlacement = useCallback((index: number, updates: Partial<SigPlacement>) => {
    setSignature(s => ({
      ...s,
      placements: {
        ...s.placements,
        [index]: { ...getSigPlacement(index), ...updates }
      }
    }))
  }, [getSigPlacement])

  const shouldApplySignature = useCallback((pageIndex: number, applyMode: 'all' | 'custom', customPages: string) => {
    if (applyMode === 'all') return true;
    if (!customPages.trim()) return false;
    
    const pagesToApply = new Set<number>();
    const parts = customPages.split(',');
    for (const p of parts) {
      const trimP = p.trim();
      if (!trimP) continue;
      if (trimP.includes('-')) {
        const [s, e] = trimP.split('-').map(n => parseInt(n, 10));
        if (!isNaN(s) && !isNaN(e)) {
          for(let i = Math.min(s, e); i <= Math.max(s, e); i++) pagesToApply.add(i - 1);
        }
      } else {
        const n = parseInt(trimP, 10);
        if (!isNaN(n)) pagesToApply.add(n - 1);
      }
    }
    return pagesToApply.has(pageIndex);
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
              scale: 1,
              brightness: 100,
              contrast: 100,
              grayscale: false,
              cleanBackground: false
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
            scale: 1,
            brightness: 100,
            contrast: 100,
            grayscale: false,
            cleanBackground: false
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
  const updatePageAttributes = (id: string, updates: Partial<PageItem>) => {
    setPages(items => items.map(item => item.id === id ? { ...item, ...updates } : item))
  }
  const clearAll = () => {
    setPages([])
    setOriginalDocName('document')
    setPreviewPageIndex(0)
    setSignature(s => ({ ...s, placements: {} }))
  }

  const handleSigImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSignature(s => ({ ...s, imageUrl: URL.createObjectURL(e.target.files![0]), mode: 'image' }))
    }
  }

  const handleRemoveSigBg = async () => {
    if (!signature.imageUrl) return
    setIsProcessing(true)
    setLoadingText('Removing Background...')
    try {
      const optimizedDataUrl = await optimizeImageForAI(signature.imageUrl)
      let removedSuccessfully = false;

      // Manual Architecture Loading for RMBG-1.4
      if (sigBgModel === 'briaai/RMBG-1.4') {
        try {
          const { AutoModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
          
          env.allowLocalModels = false; 
          
          const model = await AutoModel.from_pretrained(sigBgModel, {
            config: { model_type: 'custom' } as any,
          });

          const processor = await AutoProcessor.from_pretrained(sigBgModel, {
            config: {
              do_normalize: true,
              do_pad: false,
              do_rescale: true,
              do_resize: true,
              image_mean: [0.5, 0.5, 0.5],
              feature_extractor_type: "ImageFeatureExtractor",
              image_std: [1, 1, 1],
              resample: 2,
              rescale_factor: 0.00392156862745098,
              size: { width: 1024, height: 1024 }
            } as any
          });

          const imageToProcess = await RawImage.fromURL(optimizedDataUrl);
          const { pixel_values } = await processor(imageToProcess);
          
          const outputs = await model({ input: pixel_values });
          const outTensor = Object.values(outputs)[0] as any;
          
          if (!outTensor || !outTensor.data) throw new Error("Invalid tensor output");

          const maskWidth = outTensor.dims[3];
          const maskHeight = outTensor.dims[2];

          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = maskWidth;
          maskCanvas.height = maskHeight;
          const maskCtx = maskCanvas.getContext('2d');
          if (!maskCtx) throw new Error("Mask Context failed");

          const imgData = maskCtx.createImageData(maskWidth, maskHeight);
          for (let i = 0; i < outTensor.data.length; i++) {
             const val = Math.max(0, Math.min(255, Math.round(outTensor.data[i] * 255)));
             imgData.data[i * 4] = 0;     // R
             imgData.data[i * 4 + 1] = 0; // G
             imgData.data[i * 4 + 2] = 0; // B
             imgData.data[i * 4 + 3] = val; // Map AI output directly to transparency
          }
          maskCtx.putImageData(imgData, 0, 0);

          const originalImg = await createImage(signature.imageUrl);
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = originalImg.width;
          finalCanvas.height = originalImg.height;
          const finalCtx = finalCanvas.getContext('2d');
          if (!finalCtx) throw new Error("Final context failed");

          finalCtx.drawImage(originalImg, 0, 0);
          finalCtx.globalCompositeOperation = 'destination-in';
          finalCtx.drawImage(maskCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
          
          setSignature(s => ({ ...s, imageUrl: finalCanvas.toDataURL('image/png') }))
          removedSuccessfully = true;
        } catch (hfError) {
          console.warn("Manual RMBG-1.4 engine failed. Falling back to Imgly...", hfError);
        }
      }

      // Fallback
      if (!removedSuccessfully) {
        const fallbackModel = sigBgModel === 'briaai/RMBG-1.4' ? 'isnet' : sigBgModel;
        const bgConfig: Config = { model: fallbackModel as any, output: { format: "image/png" } }
        
        const blob = await removeBackground(signature.imageUrl, bgConfig) 
        setSignature(s => ({ ...s, imageUrl: URL.createObjectURL(blob) }))
      }
    } catch (e) {
      alert("Background removal failed.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const handleEnhanceSig = async () => {
    if (!signature.imageUrl) return
    setIsProcessing(true)
    setLoadingText('Enhancing Signature...')
    try {
      const img = await createImage(signature.imageUrl)
      const cvs = document.createElement('canvas')
      cvs.width = img.width; cvs.height = img.height
      const ctx = cvs.getContext('2d')!
      ctx.filter = 'contrast(200%) brightness(80%) grayscale(100%)'
      ctx.drawImage(img, 0, 0)
      setSignature(s => ({ ...s, imageUrl: cvs.toDataURL('image/png') }))
    } catch (e) {
      alert("Enhancement failed.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  // Drag Placement Handlers
  const handlePointerDownSig = (ctx: 'right' | 'modal') => { setIsDraggingSig(true); setDraggingContext(ctx); }
  const handlePointerUpSig = () => { setIsDraggingSig(false); setDraggingContext(null); setResizingState(null); }
  
  const handleResizeDown = (e: React.PointerEvent, corner: string, ctx: 'right' | 'modal') => {
    e.stopPropagation() 
    setResizingState({
      startX: e.clientX,
      startY: e.clientY,
      startScale: getSigPlacement(previewPageIndex).scale,
      corner
    })
    setDraggingContext(ctx)
  }

  const handlePointerMoveSig = (e: React.PointerEvent) => {
    if (!draggingContext) return

    if (resizingState) {
      const dx = e.clientX - resizingState.startX
      const dy = e.clientY - resizingState.startY
      let delta = 0
      
      if (resizingState.corner === 'br') delta = (dx + dy) * 0.2
      else if (resizingState.corner === 'tl') delta = -(dx + dy) * 0.2
      else if (resizingState.corner === 'tr') delta = (dx - dy) * 0.2
      else if (resizingState.corner === 'bl') delta = (-dx + dy) * 0.2

      const newScale = Math.max(10, Math.min(200, resizingState.startScale + delta))
      updateSigPlacement(previewPageIndex, { scale: newScale })
      return
    }

    if (isDraggingSig) {
      const ref = draggingContext === 'right' ? rightSideSigRef : modalSigRef
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      let x = ((e.clientX - rect.left) / rect.width) * 100
      let y = ((e.clientY - rect.top) / rect.height) * 100
      x = Math.max(0, Math.min(100, x))
      y = Math.max(0, Math.min(100, y))
      updateSigPlacement(previewPageIndex, { x, y })
    }
  }

  const renderSignatureOverlay = (ctx: 'right' | 'modal') => {
    const placement = getSigPlacement(previewPageIndex)
    return (
      <div 
        className="absolute transition-opacity duration-75 z-20"
        style={{
          left: `${placement.x}%`,
          top: `${placement.y}%`,
          transform: 'translate(-50%, -50%)',
          opacity: placement.opacity / 100,
          pointerEvents: 'none'
        }}
      >
        <div className="relative pointer-events-auto group">
          {signature.mode === 'text' ? (
            <span style={{ fontFamily: signature.font, color: signature.color, fontSize: `${(placement.scale / 100) * 3}rem`, whiteSpace: 'nowrap', display: 'block', padding: '4px' }}>
              {signature.text || ' '}
            </span>
          ) : signature.imageUrl ? (
            <img src={signature.imageUrl} alt="Sig" style={{ width: `${placement.scale * 3}px` }} className="mix-blend-multiply block pointer-events-none" />
          ) : (
            <div style={{ width: `${placement.scale * 3}px`, height: '40px' }} /> 
          )}
          
          <div className={`absolute inset-0 border-2 border-dashed ${(isDraggingSig || resizingState) && draggingContext === ctx ? 'border-blue-500 bg-blue-500/10' : 'border-transparent group-hover:border-slate-300'} rounded pointer-events-none transition-colors`} />
          
          <div className="absolute -top-3 -left-3 w-6 h-6 lg:w-4 lg:h-4 bg-white border-2 border-blue-500 rounded-full cursor-nwse-resize pointer-events-auto opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onPointerDown={(e) => handleResizeDown(e, 'tl', ctx)} />
          <div className="absolute -top-3 -right-3 w-6 h-6 lg:w-4 lg:h-4 bg-white border-2 border-blue-500 rounded-full cursor-nesw-resize pointer-events-auto opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onPointerDown={(e) => handleResizeDown(e, 'tr', ctx)} />
          <div className="absolute -bottom-3 -left-3 w-6 h-6 lg:w-4 lg:h-4 bg-white border-2 border-blue-500 rounded-full cursor-nesw-resize pointer-events-auto opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onPointerDown={(e) => handleResizeDown(e, 'bl', ctx)} />
          <div className="absolute -bottom-3 -right-3 w-6 h-6 lg:w-4 lg:h-4 bg-white border-2 border-blue-500 rounded-full cursor-nwse-resize pointer-events-auto opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onPointerDown={(e) => handleResizeDown(e, 'br', ctx)} />
        </div>
      </div>
    )
  }

  const renderPaginationOverlay = () => {
    if (pages.length <= 1) return null;
    return (
      <div className="absolute bottom-4 right-4 z-50 flex items-center gap-2 md:gap-4 bg-white/95 backdrop-blur shadow-xl px-4 py-2 rounded-full border border-slate-200 pointer-events-auto">
        <button 
          onClick={(e) => { e.stopPropagation(); setShowViewerGrid(!showViewerGrid) }}
          className={`p-1.5 rounded-full transition-colors ${showViewerGrid ? 'bg-[#6384A3] text-white' : 'hover:bg-slate-200 text-slate-700'}`}
          title="View All Pages"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        
        <div className="h-4 w-px bg-slate-300 mx-1" />

        <button 
          onClick={(e) => { e.stopPropagation(); setPreviewPageIndex(p => Math.max(0, p - 1)) }} 
          disabled={previewPageIndex === 0 || showViewerGrid} 
          className="p-1 rounded-full hover:bg-slate-200 disabled:opacity-50 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-xs font-bold text-slate-700 tracking-widest whitespace-nowrap min-w-[90px] text-center">
          PAGE {previewPageIndex + 1} OF {pages.length}
        </span>
        <button 
          onClick={(e) => { e.stopPropagation(); setPreviewPageIndex(p => Math.min(pages.length - 1, p + 1)) }} 
          disabled={previewPageIndex === pages.length - 1 || showViewerGrid} 
          className="p-1 rounded-full hover:bg-slate-200 disabled:opacity-50 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    )
  }

  const renderSignatureControls = (context: 'sidebar' | 'modal') => {
    const currentPlacement = getSigPlacement(previewPageIndex)
    return (
      <div className="space-y-4 animate-in fade-in w-full">
        <div className="flex bg-slate-100 p-1 rounded">
          <button onClick={() => setSignature(s => ({ ...s, mode: 'text' }))} className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-widest rounded ${signature.mode === 'text' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>Text</button>
          <button onClick={() => setSignature(s => ({ ...s, mode: 'image' }))} className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-widest rounded ${signature.mode === 'image' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>Image</button>
        </div>

        {signature.mode === 'text' && (
          <div className="space-y-3">
            <input type="text" value={signature.text} onChange={(e) => setSignature(s => ({ ...s, text: e.target.value }))} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" placeholder="Type name..." />
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Font Style</label>
                <CustomDropdown 
                  value={signature.font} 
                  onChange={(val) => setSignature(s => ({ ...s, font: val }))} 
                  options={[
                    { value: 'Brush Script MT, cursive', label: 'Cursive' },
                    { value: 'Arial, sans-serif', label: 'Arial' },
                    { value: 'Times New Roman, serif', label: 'Times' },
                    { value: 'Courier New, monospace', label: 'Typewriter' }
                  ]} 
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Text Color</label>
                <div className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded p-1 h-9">
                  <input type="color" value={signature.color} onChange={(e) => setSignature(s => ({ ...s, color: e.target.value }))} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0 flex-shrink-0" />
                  <span className="text-[10px] font-mono font-bold text-slate-500 truncate">{signature.color.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {signature.mode === 'image' && (
          <div className="space-y-3">
            <button onClick={() => document.getElementById('sig-upload')?.click()} className="w-full py-2 bg-slate-50 border border-slate-200 text-slate-600 font-bold text-[10px] uppercase tracking-widest rounded hover:bg-slate-100 flex items-center justify-center gap-2">
              <ImageIcon className="w-3 h-3" /> Upload Signature Image
            </button>
            <input type="file" id="sig-upload" accept="image/*" className="hidden" onChange={handleSigImageUpload} />
            
            {signature.imageUrl && (
              <div className="space-y-2 mt-2">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">AI Model</label>
                <CustomDropdown 
                  value={sigBgModel} 
                  onChange={setSigBgModel} 
                  direction="up"
                  options={[
                    { value: 'briaai/RMBG-1.4', label: 'Pro AI (Best for Objects)' },
                    { value: 'isnet_fp16', label: 'Standard AI (Faster)' },
                    { value: 'isnet', label: 'Max Detail AI (Best for Edges)' }
                  ]} 
                />
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button onClick={handleRemoveSigBg} disabled={isProcessing} className="py-2 bg-[#6384A3]/10 text-[#6384A3] border border-[#6384A3]/20 font-bold text-[9px] uppercase tracking-widest rounded hover:bg-[#6384A3]/20 transition-colors">
                    Remove BG
                  </button>
                  <button onClick={handleEnhanceSig} disabled={isProcessing} className="py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold text-[9px] uppercase tracking-widest rounded hover:bg-indigo-100 transition-colors flex justify-center items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Enhance Ink
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Universal Sig Controls */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
              <span>Scale (Page {previewPageIndex + 1})</span><span>{Math.round(currentPlacement.scale)}%</span>
            </div>
            <input type="range" min="10" max="200" value={currentPlacement.scale} onChange={(e) => updateSigPlacement(previewPageIndex, { scale: Number(e.target.value) })} className="w-full accent-[#6384A3]" />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
              <span>Opacity (Page {previewPageIndex + 1})</span><span>{currentPlacement.opacity}%</span>
            </div>
            <input type="range" min="10" max="100" value={currentPlacement.opacity} onChange={(e) => updateSigPlacement(previewPageIndex, { opacity: Number(e.target.value) })} className="w-full accent-[#6384A3]" />
          </div>
          
          <div className="space-y-1 pt-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Apply To</label>
            <CustomDropdown 
              value={signature.applyMode} 
              onChange={(val) => setSignature(s => ({ ...s, applyMode: val as 'all' | 'custom' }))} 
              direction="up"
              options={[
                { value: 'all', label: 'All Pages' },
                { value: 'custom', label: 'Custom Pages' }
              ]} 
            />
            {signature.applyMode === 'custom' && (
              <input 
                type="text" 
                placeholder="e.g. 1-3, 5, 8" 
                value={signature.customPages} 
                onChange={(e) => setSignature(s => ({ ...s, customPages: e.target.value }))} 
                className="w-full p-2 mt-2 border border-slate-200 rounded text-sm bg-white" 
              />
            )}
          </div>

          {context === 'sidebar' && (
            <button onClick={() => setShowSigModal(true)} disabled={pages.length === 0 || (signature.mode === 'image' && !signature.imageUrl)} className="w-full py-2.5 bg-slate-800 text-white font-bold text-[10px] uppercase tracking-widest rounded-lg hover:bg-black transition-colors shadow-sm flex items-center justify-center gap-2">
              <Move className="w-3.5 h-3.5" /> Open Full Screen
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderPageToCanvas = async (page: PageItem, index: number, forPdf = false, skipSignature = false) => {
    const img = await createImage(page.url)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const isRotated = page.rotation % 180 !== 0
    const rawWidth = isRotated ? img.height : img.width
    const rawHeight = isRotated ? img.width : img.height

    let targetWidth = rawWidth
    let targetHeight = rawHeight

    let scaleRatio = 1
    if (forPdf && enableCompression) {
      const activePPI = ppiMode === 'custom' ? customPPI : Number(ppiMode)
      if (activePPI > 0) {
        const maxPixels = 11.7 * activePPI
        const longestSide = Math.max(targetWidth, targetHeight)
        if (longestSide > maxPixels) {
          scaleRatio = maxPixels / longestSide
        }
      }
    }

    canvas.width = targetWidth * scaleRatio
    canvas.height = targetHeight * scaleRatio

    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(((page.rotation + page.fineRotation) * Math.PI) / 180)
    
    // Apply local page filters (Brightness, Contrast, Grayscale)
    const b = page.brightness ?? 100
    const c = page.contrast ?? 100
    ctx.filter = `brightness(${b}%) contrast(${c}%) ${page.grayscale ? 'grayscale(100%)' : ''}`

    const scaleX = scaleRatio * (page.scale || 1)
    const scaleY = scaleRatio * (page.scale || 1)
    ctx.scale(scaleX, scaleY)
    
    ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.filter = 'none'

    // Clean Scan (Thresholding)
    if (cleanWatermarks || page.cleanBackground) {
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

    // Global Grayscale Compression Override
    if (forPdf && enableCompression && compressionGrayscale) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imgData.data
      for (let j = 0; j < data.length; j += 4) {
        const luma = data[j] * 0.299 + data[j+1] * 0.587 + data[j+2] * 0.114
        data[j] = luma
        data[j+1] = luma
        data[j+2] = luma
      }
      ctx.putImageData(imgData, 0, 0)
    }

    // Signature
    if (!skipSignature && signature.enabled && shouldApplySignature(index, signature.applyMode, signature.customPages)) {
      const placement = getSigPlacement(index)
      ctx.save()
      ctx.globalAlpha = placement.opacity / 100
      const sigX = (placement.x / 100) * canvas.width
      const sigY = (placement.y / 100) * canvas.height

      if (signature.mode === 'text' && signature.text) {
        const fontSize = (placement.scale / 100) * canvas.width * 0.1
        ctx.font = `${fontSize}px ${signature.font}`
        ctx.fillStyle = signature.color
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(signature.text, sigX, sigY)
      } else if (signature.mode === 'image' && signature.imageUrl) {
        const sigImg = await createImage(signature.imageUrl)
        const baseSigWidth = canvas.width * 0.3
        const drawWidth = baseSigWidth * (placement.scale / 50)
        const drawHeight = (sigImg.height / sigImg.width) * drawWidth
        ctx.drawImage(sigImg, sigX - drawWidth / 2, sigY - drawHeight / 2, drawWidth, drawHeight)
      }
      ctx.restore()
    }

    // Page Numbers
    if (addPageNumbers) {
      const fontSize = Math.max(Math.floor(canvas.width / 35), 12)
      ctx.font = `bold ${fontSize}px sans-serif`
      ctx.fillStyle = '#000000'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${index + 1} / ${pages.length}`, canvas.width / 2, canvas.height - fontSize)
    }

    // Watermark
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

    return canvas;
  }

  // --- PDF GENERATION LOGIC ---
  const generatePdfBlob = async (pagesToExport: PageItem[] = pages): Promise<Blob | null> => {
    if (pagesToExport.length === 0) return null

    let pdf: jsPDF | null = null;
    
    for (let i = 0; i < pagesToExport.length; i++) {
      const canvas = await renderPageToCanvas(pagesToExport[i], i, true)
      if (!canvas) continue

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
        const canvas = await renderPageToCanvas(pages[i], i, false)
        if(!canvas) continue
        
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
        const canvas = await renderPageToCanvas(pages[i], i, false)
        if (!canvas) continue
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.95))
        if (blob) zip.file(`page-${String(i + 1).padStart(3, '0')}.jpg`, blob)
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

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px]">
        
        {/* Sidebar Settings */}
        <div className="w-full lg:w-80 h-auto lg:h-full flex flex-col bg-slate-50 border-b lg:border-b-0 lg:border-r border-slate-200 order-2 lg:order-1 relative">
          <div className="p-4 lg:p-6 pb-2 border-b border-slate-200 flex-shrink-0 z-10 bg-slate-50">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Doc Settings
            </h4>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto p-4 lg:p-6 pt-4 pb-4">
            
            {/* Merge Accordion */}
            <div ref={(el) => { panelRefs.current['merge'] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative ${activePanel === 'merge' ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
              <button onClick={() => setActivePanel(activePanel === 'merge' ? null : 'merge')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === 'merge' ? 'rounded-t-lg' : 'rounded-lg'}`}>
                <Layers className="w-4 h-4 text-[#6384A3]" /> Merge Documents
              </button>
              {activePanel === 'merge' && (
                <div className="p-4 space-y-4 border-t border-slate-100 rounded-b-lg">
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
            <div ref={(el) => { panelRefs.current['split'] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative ${activePanel === 'split' ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
              <button onClick={() => setActivePanel(activePanel === 'split' ? null : 'split')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === 'split' ? 'rounded-t-lg' : 'rounded-lg'}`}>
                <Scissors className="w-4 h-4 text-[#6384A3]" /> Split Document
              </button>
              {activePanel === 'split' && (
                <div className="p-4 space-y-4 border-t border-slate-100 rounded-b-lg">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Ranges to extract (e.g. 1-2, 5, 8-10)</p>
                  <input type="text" placeholder="1-3, 5-6" value={splitRanges} onChange={(e) => setSplitRanges(e.target.value)} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" />
                  <button onClick={handleSplitPdf} disabled={isProcessing || pages.length === 0} className="w-full py-2 bg-slate-800 text-white font-bold text-[10px] uppercase tracking-widest rounded-lg hover:bg-black transition-colors shadow-sm">
                    Download Split ZIP
                  </button>
                </div>
              )}
            </div>

            {/* Signature Studio Accordion */}
            <div ref={(el) => { panelRefs.current['signature'] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative ${activePanel === 'signature' ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
              <button onClick={() => setActivePanel(activePanel === 'signature' ? null : 'signature')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === 'signature' ? 'rounded-t-lg' : 'rounded-lg'}`}>
                <PenTool className="w-4 h-4 text-[#6384A3]" /> Signature Studio
              </button>
              {activePanel === 'signature' && (
                <div className="p-4 space-y-4 border-t border-slate-100 rounded-b-lg">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider cursor-pointer border-b border-slate-100 pb-3">
                    <input type="checkbox" checked={signature.enabled} onChange={(e) => setSignature(s => ({ ...s, enabled: e.target.checked }))} className="w-4 h-4 accent-[#6384A3] rounded" />
                    Enable Signature
                  </label>

                  {signature.enabled && (
                    <div className="space-y-4 animate-in fade-in">
                      {renderSignatureControls('sidebar')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Enhance & Clean Accordion */}
            <div ref={(el) => { panelRefs.current['enhance'] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative ${activePanel === 'enhance' ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
              <button onClick={() => setActivePanel(activePanel === 'enhance' ? null : 'enhance')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === 'enhance' ? 'rounded-t-lg' : 'rounded-lg'}`}>
                <Wand2 className="w-4 h-4 text-[#6384A3]" /> Scan Cleaner (Global)
              </button>
              {activePanel === 'enhance' && (
                <div className="p-4 space-y-4 border-t border-slate-100 rounded-b-lg">
                  <label className="flex items-start gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={cleanWatermarks} onChange={(e) => setCleanWatermarks(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[#6384A3] rounded" />
                    <div>
                      <span className="uppercase tracking-wider">Remove Faint Watermarks</span>
                      <p className="text-[9px] text-slate-400 font-normal mt-1 leading-tight">Washes out light colors, shadows, and faint watermarks while preserving dark text for scanned documents globally.</p>
                    </div>
                  </label>
                  <p className="text-[10px] text-[#6384A3] font-bold mt-2 pt-2 border-t border-slate-100">Pro Tip: Click the Edit icon on a specific page thumbnail for local enhancements.</p>
                </div>
              )}
            </div>

            {/* Security Accordion */}
            <div ref={(el) => { panelRefs.current['security'] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative ${activePanel === 'security' ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
              <button onClick={() => setActivePanel(activePanel === 'security' ? null : 'security')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === 'security' ? 'rounded-t-lg' : 'rounded-lg'}`}>
                <ShieldCheck className="w-4 h-4 text-[#6384A3]" /> Security & Passwords
              </button>
              {activePanel === 'security' && (
                <div className="p-4 space-y-4 border-t border-slate-100 rounded-b-lg">
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
            <div ref={(el) => { panelRefs.current['overlays'] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative ${activePanel === 'overlays' ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
              <button onClick={() => setActivePanel(activePanel === 'overlays' ? null : 'overlays')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === 'overlays' ? 'rounded-t-lg' : 'rounded-lg'}`}>
                <Type className="w-4 h-4 text-[#6384A3]" /> Text Overlays
              </button>
              {activePanel === 'overlays' && (
                <div className="p-4 space-y-4 border-t border-slate-100 rounded-b-lg">
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
            <div ref={(el) => { panelRefs.current['compression'] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative ${activePanel === 'compression' ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
              <button onClick={() => setActivePanel(activePanel === 'compression' ? null : 'compression')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === 'compression' ? 'rounded-t-lg' : 'rounded-lg'}`}>
                <SlidersHorizontal className="w-4 h-4 text-[#6384A3]" /> Doc Compression
              </button>
              {activePanel === 'compression' && (
                <div className="p-4 space-y-4 border-t border-slate-100 rounded-b-lg">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider cursor-pointer">
                    <input type="checkbox" checked={enableCompression} onChange={(e) => setEnableCompression(e.target.checked)} className="w-4 h-4 accent-[#6384A3] rounded" />
                    Force File Shrink
                  </label>
                  {enableCompression ? (
                    <div className="space-y-3 animate-in fade-in pt-2 border-t border-slate-100 mt-2">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                          <span>JPEG Quality</span>
                          <span className="text-[#6384A3]">{compressionQuality}%</span>
                        </div>
                        <input type="range" min="10" max="100" value={compressionQuality} onChange={(e) => setCompressionQuality(Number(e.target.value))} className="w-full accent-[#6384A3]" />
                      </div>
                      
                      <div className="space-y-1 pt-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Max Resolution (PPI)</label>
                        <CustomDropdown 
                          value={ppiMode} 
                          onChange={(val) => setPpiMode(val)} 
                          direction="up"
                          options={[
                            { value: '72', label: '72 PPI (Web / Smallest)' },
                            { value: '150', label: '150 PPI (Medium)' },
                            { value: '300', label: '300 PPI (Print / High)' },
                            { value: '0', label: 'Original Resolution' },
                            { value: 'custom', label: 'Custom PPI Range' }
                          ]} 
                        />
                        {ppiMode === 'custom' && (
                          <div className="space-y-1 mt-3 p-2 bg-slate-50 border border-slate-100 rounded">
                            <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                              <span>Custom PPI</span>
                              <span className="text-[#6384A3]">{customPPI} PPI</span>
                            </div>
                            <input 
                              type="range" 
                              min="10" 
                              max="1200" 
                              value={customPPI} 
                              onChange={(e) => setCustomPPI(Number(e.target.value))} 
                              className="w-full accent-[#6384A3]" 
                            />
                          </div>
                        )}
                      </div>

                      <div className="pt-1">
                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={compressionGrayscale} 
                            onChange={(e) => setCompressionGrayscale(e.target.checked)} 
                            className="w-3.5 h-3.5 accent-[#6384A3] rounded cursor-pointer" 
                          />
                          Convert to Grayscale
                        </label>
                      </div>
                      <p className="text-[9px] text-slate-400 leading-tight">These settings apply to PDF exports to significantly reduce file size.</p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500">Currently exporting visually lossless JPEGs for optimal quality/size balance.</p>
                  )}
                </div>
              )}
            </div>

            {/* Export Format Accordion */}
            <div ref={(el) => { panelRefs.current['export'] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative mb-4 ${activePanel === 'export' ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
              <button onClick={() => setActivePanel(activePanel === 'export' ? null : 'export')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === 'export' ? 'rounded-t-lg' : 'rounded-lg'}`}>
                <Type className="w-4 h-4 text-[#6384A3]" /> Format & Export
              </button>
              {activePanel === 'export' && (
                <div className="p-4 bg-white border-t border-slate-100 space-y-4 rounded-b-lg">
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
                </div>
              )}
            </div>

          </div>

          {/* Global Actions (Sticky Bottom) */}
          <div className="p-4 lg:p-6 border-t border-slate-200 flex-shrink-0 z-10 bg-slate-50">
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

        {/* Main Grid / Preview Area */}
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
          ) : activePanel === 'signature' && signature.enabled && pages.length > 0 && sigPageTarget ? (
            // Live Signature Preview & Positioning (Right Side)
            <div className="flex-1 flex flex-col bg-slate-100 rounded-xl border border-slate-200 relative select-none animate-in fade-in h-full min-h-[400px] overflow-hidden">
              
              {/* Top Action Badges (Z-50) */}
              <div className="absolute top-3 left-3 z-50 bg-white/90 px-3 py-1.5 rounded shadow-sm text-[10px] font-bold text-slate-600 uppercase tracking-widest flex items-center gap-2 border border-slate-200 pointer-events-none">
                <Move className="w-3.5 h-3.5" /> Drag or Resize Signature
              </div>

              <div className="absolute top-3 right-3 z-50 pointer-events-auto">
                <button
                  onClick={() => setShowSigModal(true)}
                  className="bg-white/90 hover:bg-white text-slate-700 px-3 py-1.5 rounded shadow-sm text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-slate-200 transition-colors"
                  title="Open Full Screen"
                >
                  <Move className="w-3.5 h-3.5" /> Full Screen
                </button>
              </div>

              {renderPaginationOverlay()}

              {/* PDF Viewer Container (Padded to strictly prevent image overlap with top/bottom UI) */}
              <div className="flex-1 overflow-hidden relative touch-none px-4 pt-16 pb-20 w-full h-full flex items-center justify-center">
                {showViewerGrid ? (
                  <div className="absolute inset-0 z-40 bg-slate-100 overflow-y-auto px-4 pt-16 pb-20 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-in fade-in">
                    {pages.map((p, idx) => (
                      <div key={p.id} onClick={() => { setPreviewPageIndex(idx); setShowViewerGrid(false); }} className={`cursor-pointer border-2 rounded-lg overflow-hidden aspect-[3/4] relative transition-colors bg-white shadow-sm ${previewPageIndex === idx ? 'border-[#6384A3] ring-2 ring-[#6384A3]/30' : 'border-transparent hover:border-slate-300'}`}>
                        <img src={p.url} alt={`Thumb ${idx+1}`} className="w-full h-full object-contain" style={{ transform: `rotate(${p.rotation + p.fineRotation}deg)` }} />
                        <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">Page {idx + 1}</div>
                        {signature.enabled && shouldApplySignature(idx, signature.applyMode, signature.customPages) && (
                          <div className="absolute top-1 right-1 bg-[#6384A3] text-white text-[9px] px-1.5 py-0.5 rounded shadow">Signed</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    ref={rightSideSigRef}
                    className="relative shadow-none bg-slate-50touch-none inline-flex max-w-full max-h-full"
                    onPointerDown={() => handlePointerDownSig('right')}
                    onPointerMove={handlePointerMoveSig}
                    onPointerUp={handlePointerUpSig}
                    onPointerLeave={handlePointerUpSig}
                  >
                    {isGeneratingSigPreview ? (
                      <div className="flex flex-col items-center justify-center h-[50vh] w-[30vh] text-slate-400">
                         <svg className="animate-spin w-8 h-8 text-[#6384A3] mb-4" fill="none" viewBox="0 0 24 24">
                           <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                           <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                         </svg>
                         <span className="text-[10px] uppercase tracking-widest font-bold">Rendering View...</span>
                      </div>
                    ) : sigPreviewUrl ? (
                      <>
                        <img 
                          src={sigPreviewUrl} 
                          className="block pointer-events-none" 
                          style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }}
                          alt="Placement Target" 
                          draggable={false}
                        />
                        {renderSignatureOverlay('right')}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : (
            // DND Page Grid View
            <div className="flex-1 overflow-y-auto pr-2 animate-in fade-in touch-none">
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
                        brightness={page.brightness}
                        contrast={page.contrast}
                        grayscale={page.grayscale}
                        cleanBackground={page.cleanBackground}
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

      {/* Fullscreen Signature Modal */}
      {showSigModal && sigPageTarget && (
        <div className="fixed inset-0 z-[160] bg-slate-900/95 flex flex-col md:flex-row animate-in fade-in duration-200">
          
          {/* Settings Sidebar for Modal */}
          <div className="w-full md:w-80 bg-white md:h-full flex flex-col border-b md:border-b-0 md:border-r border-slate-200 overflow-y-auto shrink-0 z-40">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 sticky top-0 z-10">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <PenTool className="w-4 h-4 text-[#6384A3]" /> Signature Studio
              </h3>
              <button onClick={() => setShowSigModal(false)} className="text-slate-400 hover:text-red-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-visible">
              {renderSignatureControls('modal')}
              <button onClick={() => setShowSigModal(false)} className="w-full mt-4 px-8 py-3 bg-slate-800 hover:bg-black text-white font-bold rounded uppercase tracking-widest text-xs transition-colors shadow-sm">
                Save & Close
              </button>
            </div>
          </div>
          
          {/* Draggable Viewport in Modal */}
          <div className="flex-1 relative touch-none select-none bg-slate-100 overflow-hidden flex flex-col">
              
             {/* Zoom Controls Overlay */}
             <div className="absolute top-4 right-4 z-50 flex gap-1 bg-slate-800/90 p-1.5 rounded-lg backdrop-blur border border-slate-700 shadow-xl">
               <button onClick={() => setSigZoom(z => Math.max(0.25, z - 0.25))} className="p-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition-colors"><ZoomOut className="w-4 h-4"/></button>
               <div className="flex items-center justify-center px-3 min-w-[4rem] text-xs font-bold text-slate-300 tracking-widest">{Math.round(sigZoom * 100)}%</div>
               <button onClick={() => setSigZoom(z => Math.min(4, z + 0.25))} className="p-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition-colors"><ZoomIn className="w-4 h-4"/></button>
             </div>

             {renderPaginationOverlay()}

             {/* Modal PDF Viewer Container (Padded to strictly prevent image overlap with UI) */}
             <div className="flex-1 overflow-auto relative w-full h-full z-10 px-4 pt-20 pb-24 md:px-8 md:pt-20 md:pb-24 flex custom-scrollbar">
               {showViewerGrid ? (
                 <div className="absolute inset-0 z-40 bg-slate-900/95 overflow-y-auto px-4 pt-20 pb-24 md:px-8 md:pt-20 md:pb-24 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-in fade-in">
                   {pages.map((p, idx) => (
                     <div key={p.id} onClick={() => { setPreviewPageIndex(idx); setShowViewerGrid(false); }} className={`cursor-pointer border-2 rounded-lg overflow-hidden aspect-[3/4] relative transition-colors bg-white shadow-xl ${previewPageIndex === idx ? 'border-blue-400 ring-2 ring-blue-400' : 'border-transparent hover:border-slate-500'}`}>
                       <img src={p.url} alt={`Thumb ${idx+1}`} className="w-full h-full object-contain bg-slate-800" style={{ transform: `rotate(${p.rotation + p.fineRotation}deg)` }} />
                       <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">Page {idx + 1}</div>
                       {signature.enabled && shouldApplySignature(idx, signature.applyMode, signature.customPages) && (
                         <div className="absolute top-1 right-1 bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded shadow">Signed</div>
                       )}
                     </div>
                   ))}
                 </div>
               ) : (
                 <div className="m-auto flex items-center justify-center min-w-max min-h-max transition-all">
                   <div 
                     ref={modalSigRef}
                     className="relative shadow-2xl bg-white touch-none inline-block"
                     onPointerDown={() => handlePointerDownSig('modal')}
                     onPointerMove={handlePointerMoveSig}
                     onPointerUp={handlePointerUpSig}
                     onPointerLeave={handlePointerUpSig}
                   >
                     {isGeneratingSigPreview ? (
                       <div className="flex flex-col items-center justify-center h-[70vh] w-[50vh] text-slate-400">
                          <svg className="animate-spin w-8 h-8 text-[#6384A3] mb-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span className="text-[10px] uppercase tracking-widest font-bold">Rendering View...</span>
                       </div>
                     ) : sigPreviewUrl ? (
                       <>
                         <img 
                           src={sigPreviewUrl} 
                           className="block pointer-events-none" 
                           style={{ height: `${75 * sigZoom}vh`, width: 'auto', maxWidth: 'none' }}
                           alt="Placement Target" 
                           draggable={false}
                         />
                         {renderSignatureOverlay('modal')}
                       </>
                     ) : null}
                   </div>
                 </div>
               )}
             </div>
          </div>
        </div>
      )}

      {/* Editing Modal (Page Specific Enhancements) */}
      {editingPageData && (
        <div className="fixed inset-0 z-[150] bg-slate-900/90 flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#6384A3]" /> Edit Page {pages.findIndex(p => p.id === editingPageData.id) + 1}
              </h3>
              <button onClick={() => setEditingPageId(null)} className="text-slate-400 hover:text-red-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Precision Viewport Canvas */}
            <div className="p-4 sm:p-6 bg-slate-800 flex items-center justify-center relative overflow-hidden" style={{ minHeight: '300px' }}>
              <div className="absolute inset-0 pointer-events-none opacity-10" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
              
              <div className="relative inline-block border-2 border-transparent overflow-visible shadow-2xl">
                <img src={editingPageData.url} className="max-h-[35vh] sm:max-h-[40vh] opacity-0 pointer-events-none" alt="" />
                
                <div className="absolute inset-0 flex items-center justify-center overflow-visible bg-white">
                   <img 
                     src={editingPageData.url} 
                     className="w-full h-full object-contain max-w-none max-h-none pointer-events-none" 
                     style={{ 
                       transform: `rotate(${editingPageData.rotation + editingPageData.fineRotation}deg) scale(${editingPageData.scale || 1})`,
                       filter: `brightness(${editingPageData.brightness}%) contrast(${editingPageData.contrast}%) ${editingPageData.grayscale ? 'grayscale(100%)' : ''} ${editingPageData.cleanBackground ? 'contrast(150%) brightness(110%)' : ''}`.trim()
                     }} 
                     alt="Editing preview"
                   />
                </div>

                <div className="absolute inset-0 pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] z-10 border border-white/50" />
                
                <div className="absolute inset-0 pointer-events-none border border-[#6384A3] z-20 flex items-center justify-center">
                   <div className="w-full h-px bg-[#6384A3]/50 absolute top-1/2 -translate-y-1/2" />
                   <div className="h-full w-px bg-[#6384A3]/50 absolute left-1/2 -translate-x-1/2" />
                </div>
              </div>
            </div>
            
            <div className="p-6 space-y-5 bg-white border-t border-slate-200 overflow-y-auto">
              
              <div className="grid grid-cols-2 gap-6 pb-2">
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                    <span>Rotation</span>
                    <span className="text-[#6384A3]">{editingPageData.fineRotation}°</span>
                  </div>
                  <input 
                    type="range" 
                    min="-45" 
                    max="45" 
                    step="0.5" 
                    value={editingPageData.fineRotation} 
                    onChange={(e) => updatePageAttributes(editingPageData.id, { fineRotation: Number(e.target.value) })} 
                    className="w-full accent-[#6384A3]" 
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                    <span>Zoom</span>
                    <span className="text-[#6384A3]">{(editingPageData.scale || 1).toFixed(2)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="3" 
                    step="0.05" 
                    value={editingPageData.scale || 1} 
                    onChange={(e) => updatePageAttributes(editingPageData.id, { scale: Number(e.target.value) })} 
                    className="w-full accent-[#6384A3]" 
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <h4 className="text-[10px] font-bold text-slate-800 uppercase tracking-widest mb-3">Enhancements (This Page)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Brightness</label>
                    <input type="range" min="50" max="150" value={editingPageData.brightness} onChange={(e) => updatePageAttributes(editingPageData.id, { brightness: Number(e.target.value) })} className="w-full accent-[#6384A3]" />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Contrast</label>
                    <input type="range" min="50" max="150" value={editingPageData.contrast} onChange={(e) => updatePageAttributes(editingPageData.id, { contrast: Number(e.target.value) })} className="w-full accent-[#6384A3]" />
                  </div>
                </div>
                
                <div className="flex flex-col gap-2 mt-4">
                  <label className="flex items-center gap-2 text-[10px] font-bold text-slate-700 uppercase tracking-widest cursor-pointer">
                    <input type="checkbox" checked={editingPageData.grayscale} onChange={(e) => updatePageAttributes(editingPageData.id, { grayscale: e.target.checked })} className="w-3.5 h-3.5 accent-[#6384A3] rounded" />
                    Black & White (Grayscale)
                  </label>
                  <label className="flex items-center gap-2 text-[10px] font-bold text-slate-700 uppercase tracking-widest cursor-pointer">
                    <input type="checkbox" checked={editingPageData.cleanBackground} onChange={(e) => updatePageAttributes(editingPageData.id, { cleanBackground: e.target.checked })} className="w-3.5 h-3.5 accent-[#6384A3] rounded" />
                    Clean Scan Background (Wash Faint Colors)
                  </label>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button onClick={() => updatePageAttributes(editingPageData.id, { fineRotation: 0, scale: 1, brightness: 100, contrast: 100, grayscale: false, cleanBackground: false })} className="flex-[0.5] py-2.5 px-4 text-xs font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50 uppercase tracking-widest">Reset</button>
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