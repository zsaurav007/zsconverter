'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import { removeBackground, Config } from '@imgly/background-removal'
import { DndContext, closestCenter, TouchSensor, MouseSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Settings2, Trash2, Eye, Download, RotateCw, Lock, Unlock, FileText, Type, SlidersHorizontal, X, FileImage, ShieldCheck, Layers, Scissors, Wand2, Hash, Edit3, PenTool, Image as ImageIcon, Sparkles, Move, ChevronLeft, ChevronRight, LayoutGrid, ZoomIn, ZoomOut, Plus, Trash, MoreVertical, CheckCircle2, Undo2 } from 'lucide-react'
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

  const MAX_DIM = 1500
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

// Multi-pass Document Text Extraction (Sauvola Binarization Algorithm)
const processDocumentTextExtraction = async (imageUrl: string): Promise<string> => {
  const img = await createImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const width = canvas.width;
  const height = canvas.height;

  // 1. Grayscale luminance calculation
  const gray = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }

  // 2. Fast Integral Image for Adaptive Local Thresholding
  const intImg = new Float64Array(width * height);
  const intSqImg = new Float64Array(width * height);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    let sqSum = 0;
    for (let x = 0; x < width; x++) {
      const val = gray[y * width + x];
      sum += val;
      sqSum += val * val;
      
      const prevY = y > 0 ? (y - 1) * width + x : 0;
      intImg[y * width + x] = (y > 0 ? intImg[prevY] : 0) + sum;
      intSqImg[y * width + x] = (y > 0 ? intSqImg[prevY] : 0) + sqSum;
    }
  }

  // 3. Sauvola Adaptive Thresholding
  const windowSize = Math.max(15, Math.floor(width / 25)); 
  const k = 0.3; 
  const R = 128; 

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(x - windowSize, 0);
      const x2 = Math.min(x + windowSize, width - 1);
      const y1 = Math.max(y - windowSize, 0);
      const y2 = Math.min(y + windowSize, height - 1);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      const sum = intImg[y2 * width + x2] 
                - (y1 > 0 ? intImg[(y1 - 1) * width + x2] : 0) 
                - (x1 > 0 ? intImg[y2 * width + (x1 - 1)] : 0) 
                + (y1 > 0 && x1 > 0 ? intImg[(y1 - 1) * width + (x1 - 1)] : 0);
                
      const sqSum = intSqImg[y2 * width + x2] 
                - (y1 > 0 ? intSqImg[(y1 - 1) * width + x2] : 0) 
                - (x1 > 0 ? intSqImg[y2 * width + (x1 - 1)] : 0) 
                + (y1 > 0 && x1 > 0 ? intSqImg[(y1 - 1) * width + (x1 - 1)] : 0);

      const mean = sum / count;
      const variance = (sqSum / count) - (mean * mean);
      const stddev = Math.sqrt(Math.max(variance, 0));

      const threshold = mean * (1 + k * ((stddev / R) - 1));
      
      const idx = (y * width + x) * 4;
      const currentGray = gray[y * width + x];

      // Deep clean logic: Darker than threshold means it's text.
      if (currentGray < threshold && currentGray < 180) {
        data[idx] = 0;     // Force Pure Black
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      } else {
        data[idx + 3] = 0; // Completely transparent background
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
};

// --- DATA STRUCTURES & FILTERS ---
type PageItem = { 
  id: string; 
  url: string; 
  originalUrl: string; 
  isLossless: boolean; 
  rotation: number; 
  fineRotation: number; 
  scale: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  grayscale: boolean;
  sepia: number;
  sharpen: number;
}

const getFilterString = (page: PageItem) => {
  const b = 100 + (page.brightness ?? 0);
  const c = 100 + (page.contrast ?? 0);
  const sat = 100 + (page.saturation ?? 0);
  const hue = page.hue ?? 0;
  const sep = Math.max(0, page.sepia ?? 0);
  const gray = page.grayscale ? 100 : 0;
  const s = (page.sharpen ?? 0) > 0 ? `url(#sharpen-${page.id}) ` : '';
  
  return `${s}brightness(${b}%) contrast(${c}%) saturate(${sat}%) hue-rotate(${hue}deg) grayscale(${gray}%) sepia(${sep}%)`.trim();
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
  saturation: number
  hue: number
  sepia: number
  grayscale: boolean
  sharpen: number
  watermarkText: string
  watermarkPlacement: string
  watermarkOpacity: number
  addPageNumbers: boolean
  totalPages: number
  onRemove: (id: string) => void
  onRotate: (id: string) => void
  onView: (id: string) => void
}

function SortablePageItem({ id, url, index, rotation, fineRotation, scale, brightness, contrast, saturation, hue, sepia, grayscale, sharpen, watermarkText, watermarkPlacement, watermarkOpacity, addPageNumbers, totalPages, onRemove, onRotate, onView }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
  }

  const isRotated = rotation % 180 !== 0
  const imageScale = isRotated ? 0.75 : 1

  const filterStyle = getFilterString({ id, brightness, contrast, saturation, hue, sepia, grayscale, sharpen } as PageItem)

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners} 
      onClick={() => onView(id)}
      className={`relative rounded-lg overflow-hidden border ${isDragging ? 'border-[#6384A3] shadow-2xl scale-105' : 'border-slate-200'} aspect-[3/4] cursor-pointer hover:shadow-md transition-all bg-slate-100 flex items-center justify-center group touch-none`}
    >
      <div className="w-full h-full flex items-center justify-center overflow-hidden bg-slate-100 relative">
        <div style={{ transform: `rotate(${rotation + fineRotation}deg) scale(${imageScale * scale})`, transition: 'transform 0.15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          <img 
            src={url} 
            alt={`Page ${index + 1}`} 
            className="max-w-full max-h-full object-contain pointer-events-none bg-white shadow-sm" 
            style={{ filter: filterStyle || 'none' }}
          />
        </div>
        
        {/* Grid View Overlays */}
        {watermarkText && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden z-20 flex" style={{ opacity: watermarkOpacity / 100 }}>
             <div 
               className={`absolute font-bold text-slate-500 whitespace-nowrap opacity-50 ${
                 watermarkPlacement === 'center' ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-xl' :
                 watermarkPlacement === 'top-left' ? 'top-2 left-2 text-[8px]' :
                 watermarkPlacement === 'top-right' ? 'top-2 right-2 text-[8px]' :
                 watermarkPlacement === 'bottom-left' ? 'bottom-6 left-2 text-[8px]' :
                 'bottom-6 right-2 text-[8px]'
               }`}
             >
               {watermarkText}
             </div>
          </div>
        )}
        {addPageNumbers && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 text-slate-800 font-bold text-[8px] pointer-events-none">
            {index + 1} / {totalPages}
          </div>
        )}
      </div>
      
      {/* Fixed Tools in Grid */}
      <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-100 z-30">
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
      </div>

      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded font-bold shadow-sm flex items-center gap-1 z-30">
        {index + 1}
        {(fineRotation !== 0 || scale !== 1 || brightness !== 0 || contrast !== 0 || grayscale || sepia > 0 || hue !== 0 || saturation !== 0 || sharpen > 0) && <span className="text-[#6384A3] ml-1">Edited</span>}
      </div>
    </div>
  )
}

// --- SLIDER HELPER ---
const SliderControl = ({ label, value, min, max, step = 1, onChange, onPointerDown, onPointerUp, unit = "%" }: { label: string, value: number, min: number, max: number, step?: number, onChange: (v: number) => void, onPointerDown?: () => void, onPointerUp?: () => void, unit?: string }) => (
  <div className="space-y-1.5 w-full">
    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
      <span>{label}</span><span className="text-[#6384A3]">{value > 0 ? '+' : ''}{value}{unit}</span>
    </div>
    <input 
      type="range" 
      min={min} 
      max={max} 
      step={step} 
      value={value} 
      onPointerDown={onPointerDown} 
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onTouchStart={onPointerDown}
      onTouchEnd={onPointerUp}
      onChange={(e) => onChange(Number(e.target.value))} 
      className="w-full accent-[#6384A3] h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" 
    />
  </div>
);

// --- MAIN COMPONENT ---
type SigPlacement = { x: number, y: number, scale: number, opacity: number }

type SignatureItem = {
  id: string;
  mode: 'text' | 'image';
  text: string;
  font: string;
  color: string;
  imageUrl: string | null;
  applyMode: 'all' | 'custom';
  customPages: string;
  placements: Record<number, SigPlacement>; 
}

type PanelId = 'security' | 'overlays' | 'compression' | 'merge' | 'split' | 'enhance' | 'signature' | 'export' | 'page-edit' | null;
type FullScreenMode = 'edit' | 'preview' | null;

export default function PdfEditor() {
  const [pages, setPages] = useState<PageItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [toast, setToast] = useState<{message: string, id: number} | null>(null)
  
  const [originalDocName, setOriginalDocName] = useState('document')

  // Global Undo History
  const [history, setHistory] = useState<{pages: PageItem[], signatures: SignatureItem[]}[]>([])

  // UI State
  const [activePanel, setActivePanel] = useState<PanelId>('export')
  const [fullScreenMode, setFullScreenMode] = useState<FullScreenMode>(null)
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [showViewerGrid, setShowViewerGrid] = useState(false)
  const [isStraightening, setIsStraightening] = useState(false)

  useEffect(() => {
    if (activePanel && panelRefs.current[activePanel]) {
      setTimeout(() => {
        panelRefs.current[activePanel]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 150)
    }

    if (activePanel === 'merge' || activePanel === 'split') {
      setShowViewerGrid(true);
    } else if (activePanel === 'page-edit' || activePanel === 'signature') {
      setShowViewerGrid(false);
    }
  }, [activePanel])

  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ message, id });
    setTimeout(() => {
      setToast(current => current?.id === id ? null : current);
    }, 3000);
  }, []);

  const [unlockPassword, setUnlockPassword] = useState('')
  const [encryptPassword, setEncryptPassword] = useState('')
  
  const [watermarkText, setWatermarkText] = useState('')
  const [watermarkPlacement, setWatermarkPlacement] = useState('center')
  const [watermarkOpacity, setWatermarkOpacity] = useState(30)
  const [addPageNumbers, setAddPageNumbers] = useState(false)
  
  // Multiple Signatures State
  const [signatures, setSignatures] = useState<SignatureItem[]>([])
  const [activeSigId, setActiveSigId] = useState<string | null>(null)
  const [sigBgModel, setSigBgModel] = useState('document-advanced')
  const [pageBgModel, setPageBgModel] = useState('document-advanced')
  
  const [openMenuSigId, setOpenMenuSigId] = useState<string | null>(null)

  const [isDraggingSig, setIsDraggingSig] = useState(false)
  const [draggingSigId, setDraggingSigId] = useState<string | null>(null)
  const [draggingContext, setDraggingContext] = useState<'right' | 'modal' | null>(null)
  const [resizingState, setResizingState] = useState<{ startX: number, startY: number, startScale: number, corner: string, sigId: string } | null>(null)
  
  const [previewPageIndex, setPreviewPageIndex] = useState(0)
  const [sigZoom, setSigZoom] = useState(0.75) // Default zoom set to 75%

  const rightSideSigRef = useRef<HTMLDivElement>(null)
  const modalSigRef = useRef<HTMLDivElement>(null)

  // Compression & Export State
  const [enableCompression, setEnableCompression] = useState(false)
  const [compressionQuality, setCompressionQuality] = useState(70)
  const [ppiMode, setPpiMode] = useState<string>('150')
  const [customPPI, setCustomPPI] = useState<number>(150)
  const [compressionGrayscale, setCompressionGrayscale] = useState(false)
  const [estimatedSizes, setEstimatedSizes] = useState<{ original: string, compressed: string } | null>(null)

  const [cleanWatermarks, setCleanWatermarks] = useState(false)
  const [splitRanges, setSplitRanges] = useState('')
  const [exportFormat, setExportFormat] = useState('pdf')

  // -- DERIVED STATES --
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

  // --- HISTORY LOGIC ---
  const saveHistory = useCallback(() => {
    setHistory(prev => {
      const clonedPages = pages.map(p => ({ ...p }));
      const clonedSigs = signatures.map(s => ({
        ...s,
        placements: { ...s.placements }
      }));
      return [...prev.slice(-29), { pages: clonedPages, signatures: clonedSigs }];
    });
  }, [pages, signatures]);

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const prevState = newHistory.pop();
      if (prevState) {
        setPages(prevState.pages);
        setSignatures(prevState.signatures);
        showToast('Undo successful');
      }
      return newHistory;
    });
  }, [showToast]);

  // --- COMPRESSION SIZE ESTIMATOR ---
  useEffect(() => {
    if (activePanel === 'compression' && pages.length > 0) {
      let isMounted = true;
      const estimateSizes = async () => {
        try {
          let origBytes = 0;
          for (const p of pages) {
            if (p.url.startsWith('data:')) {
              origBytes += p.url.length * 0.75;
            } else {
              try {
                const res = await fetch(p.url);
                const blob = await res.blob();
                origBytes += blob.size;
              } catch {
                origBytes += 1024 * 1024;
              }
            }
          }

          let compBytes = origBytes;
          if (enableCompression) {
            compBytes = origBytes * (compressionQuality / 100) * 0.8;
          }

          if (isMounted) {
            const format = (bytes: number) => {
              if (bytes === 0) return '0 B';
              const k = 1024;
              const sizes = ['B', 'KB', 'MB', 'GB'];
              const i = Math.floor(Math.log(bytes) / Math.log(k));
              return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            };
            setEstimatedSizes({ original: format(origBytes), compressed: format(compBytes) });
          }
        } catch (e) {
          console.error("Size estimation failed silently", e);
        }
      };
      
      const timer = setTimeout(estimateSizes, 400);
      return () => { isMounted = false; clearTimeout(timer); };
    }
  }, [activePanel, pages, enableCompression, compressionQuality, ppiMode, customPPI, compressionGrayscale]);

  // --- SIGNATURE HELPERS ---
  const addNewSignature = () => {
    saveHistory();
    const newSig: SignatureItem = {
      id: `sig-${Date.now()}`,
      mode: 'text',
      text: 'New Signature',
      font: 'Brush Script MT, cursive',
      color: '#000033',
      imageUrl: null,
      applyMode: 'all',
      customPages: '',
      placements: {}
    }
    setSignatures(prev => [...prev, newSig])
    setActiveSigId(newSig.id)
    showToast('New signature added')
  }

  const updateSignature = (id: string, updates: Partial<SignatureItem>) => {
    setSignatures(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  const removeSignature = (id: string) => {
    saveHistory();
    const newSigs = signatures.filter(s => s.id !== id);
    setSignatures(newSigs);
    if (activeSigId === id) {
      setActiveSigId(newSigs.length > 0 ? newSigs[0].id : null);
    }
    showToast('Signature removed');
  }

  const getSigPlacement = useCallback((sig: SignatureItem | undefined, index: number) => {
    if (!sig) return { x: 50, y: 80, scale: 50, opacity: 100 }
    return sig.placements?.[index] || { x: 50, y: 80, scale: 50, opacity: 100 }
  }, [])

  const updateSigPlacement = useCallback((sigId: string, index: number, updates: Partial<SigPlacement>) => {
    setSignatures(sigs => sigs.map(s => {
      if (s.id !== sigId) return s;
      return {
        ...s,
        placements: {
          ...s.placements,
          [index]: { ...getSigPlacement(s, index), ...updates }
        }
      }
    }))
  }, [getSigPlacement])

  const syncPlacementToAllPages = (sigId: string, sourceIndex: number) => {
    saveHistory();
    setSignatures(sigs => sigs.map(s => {
      if (s.id !== sigId) return s;
      const sourcePlacement = getSigPlacement(s, sourceIndex);
      const newPlacements: Record<number, SigPlacement> = {};
      pages.forEach((_, i) => {
        newPlacements[i] = { ...sourcePlacement };
      });
      return {
        ...s,
        applyMode: 'all',
        placements: newPlacements
      }
    }))
    showToast('Signature position applied to all pages')
  }

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
          await new Promise(r => setTimeout(r, 50))
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
            
            const dataUrl = canvas.toDataURL('image/png')
            newPages.push({
              id: `pdf-page-${Date.now()}-${Math.random()}`,
              url: dataUrl, originalUrl: dataUrl, isLossless: true,
              rotation: 0, fineRotation: 0, scale: 1, brightness: 0, contrast: 0,
              saturation: 0, hue: 0, sepia: 0, grayscale: false, sharpen: 0
            })
          }
        } else if (file.type.startsWith('image/')) {
          setLoadingText('Adding image...')
          await new Promise(r => setTimeout(r, 50))
          const objectUrl = URL.createObjectURL(file)
          newPages.push({
            id: `image-${file.name}-${Date.now()}`,
            url: objectUrl, originalUrl: objectUrl, isLossless: file.type === 'image/png' || file.type === 'image/webp',
            rotation: 0, fineRotation: 0, scale: 1, brightness: 0, contrast: 0,
            saturation: 0, hue: 0, sepia: 0, grayscale: false, sharpen: 0
          })
        }
      }

      saveHistory();
      setPages(prev => [...prev, ...newPages])
      setUnlockPassword('')
      showToast('Files loaded successfully')
    } catch (error) {
      alert("Failed to process the file. It may be corrupted or highly encrypted.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }, [unlockPassword, originalDocName, showToast, saveHistory])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] }
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      saveHistory();
      setPages((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
      showToast('Pages reordered')
    }
  }

  const removePage = (idToRemove: string) => {
    saveHistory();
    setPages(items => items.filter(item => item.id !== idToRemove))
    showToast('Page removed')
  }

  const rotatePage = (idToRotate: string) => {
    saveHistory();
    setPages(items => items.map(item => item.id === idToRotate ? { ...item, rotation: (item.rotation + 90) % 360 } : item))
    showToast('Page rotated')
  }

  const updatePageAttributes = (id: string, updates: Partial<PageItem>) => {
    setPages(items => items.map(item => item.id === id ? { ...item, ...updates } : item))
  }

  const clearAll = () => {
    saveHistory();
    setPages([])
    setOriginalDocName('document')
    setPreviewPageIndex(0)
    setSignatures([])
    setActiveSigId(null)
    showToast('All pages & settings cleared')
  }

  const handleEditPage = (id: string) => {
    const idx = pages.findIndex(p => p.id === id);
    if (idx !== -1) {
      setPreviewPageIndex(idx);
      setActivePanel('page-edit');
      setFullScreenMode('edit');
      setShowViewerGrid(false);
    }
  }

  const handlePreview = async () => {
    setFullScreenMode('preview');
    setActivePanel('export');
  }

  const enterFullscreen = () => {
    if (['merge', 'split', 'security'].includes(activePanel || '')) {
      setActivePanel('page-edit')
    }
    setFullScreenMode('edit')
  }

  const handleSigImageUpload = (sigId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      saveHistory();
      updateSignature(sigId, { imageUrl: URL.createObjectURL(e.target.files![0]), mode: 'image' })
    }
  }

  const handleRemovePageBg = async (pageId: string, imageUrl: string) => {
    if (!imageUrl) return
    setIsProcessing(true)
    setLoadingText('Removing Background from Page...')
    await new Promise(r => setTimeout(r, 50)) 

    try {
      const optimizedDataUrl = await optimizeImageForAI(imageUrl)
      let removedSuccessfully = false;

      if (pageBgModel === 'document-advanced') {
        try {
          const cleanedDataUrl = await processDocumentTextExtraction(optimizedDataUrl);
          saveHistory();
          updatePageAttributes(pageId, { url: cleanedDataUrl });
          removedSuccessfully = true;
        } catch (err) {
          console.warn("Document text extraction failed", err);
        }
      } else if (pageBgModel === 'briaai/RMBG-1.4') {
        try {
          const { AutoModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
          
          env.allowLocalModels = false; 
          
          const model = await AutoModel.from_pretrained(pageBgModel, {
            config: { model_type: 'custom' } as any,
          });

          const processor = await AutoProcessor.from_pretrained(pageBgModel, {
            config: {
              do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
              image_mean: [0.5, 0.5, 0.5], feature_extractor_type: "ImageFeatureExtractor",
              image_std: [1, 1, 1], resample: 2, rescale_factor: 0.00392156862745098,
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
             imgData.data[i * 4 + 3] = val; 
          }
          maskCtx.putImageData(imgData, 0, 0);

          const originalImg = await createImage(imageUrl);
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = originalImg.width;
          finalCanvas.height = originalImg.height;
          const finalCtx = finalCanvas.getContext('2d');
          if (!finalCtx) throw new Error("Final context failed");

          finalCtx.drawImage(originalImg, 0, 0);
          finalCtx.globalCompositeOperation = 'destination-in';
          finalCtx.drawImage(maskCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
          
          saveHistory();
          updatePageAttributes(pageId, { url: finalCanvas.toDataURL('image/png') })
          removedSuccessfully = true;
        } catch (hfError) {
          console.warn("Manual RMBG-1.4 engine failed. Falling back to Imgly...", hfError);
        }
      }

      if (!removedSuccessfully) {
        const fallbackModel = pageBgModel === 'briaai/RMBG-1.4' || pageBgModel === 'document-advanced' ? 'isnet' : pageBgModel;
        const bgConfig: Config = { model: fallbackModel as any, output: { format: "image/png" } }
        
        const blob = await removeBackground(imageUrl, bgConfig) 
        saveHistory();
        updatePageAttributes(pageId, { url: URL.createObjectURL(blob) })
      }
      showToast('Page background removed')
    } catch (e) {
      alert("Background removal failed.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const handleRemoveSigBg = async (sigId: string, imageUrl: string) => {
    if (!imageUrl) return
    setIsProcessing(true)
    setLoadingText('Removing Background...')
    await new Promise(r => setTimeout(r, 50)) 

    try {
      const optimizedDataUrl = await optimizeImageForAI(imageUrl)
      let removedSuccessfully = false;

      if (sigBgModel === 'document-advanced') {
        try {
          const cleanedDataUrl = await processDocumentTextExtraction(optimizedDataUrl);
          saveHistory();
          updateSignature(sigId, { imageUrl: cleanedDataUrl });
          removedSuccessfully = true;
        } catch (err) {
          console.warn("Document text extraction failed", err);
        }
      } else if (sigBgModel === 'briaai/RMBG-1.4') {
        try {
          const { AutoModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
          
          env.allowLocalModels = false; 
          
          const model = await AutoModel.from_pretrained(sigBgModel, {
            config: { model_type: 'custom' } as any,
          });

          const processor = await AutoProcessor.from_pretrained(sigBgModel, {
            config: {
              do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
              image_mean: [0.5, 0.5, 0.5], feature_extractor_type: "ImageFeatureExtractor",
              image_std: [1, 1, 1], resample: 2, rescale_factor: 0.00392156862745098,
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
             imgData.data[i * 4 + 3] = val; 
          }
          maskCtx.putImageData(imgData, 0, 0);

          const originalImg = await createImage(imageUrl);
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = originalImg.width;
          finalCanvas.height = originalImg.height;
          const finalCtx = finalCanvas.getContext('2d');
          if (!finalCtx) throw new Error("Final context failed");

          finalCtx.drawImage(originalImg, 0, 0);
          finalCtx.globalCompositeOperation = 'destination-in';
          finalCtx.drawImage(maskCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
          
          saveHistory();
          updateSignature(sigId, { imageUrl: finalCanvas.toDataURL('image/png') })
          removedSuccessfully = true;
        } catch (hfError) {
          console.warn("Manual RMBG-1.4 engine failed. Falling back to Imgly...", hfError);
        }
      }

      if (!removedSuccessfully) {
        const fallbackModel = sigBgModel === 'briaai/RMBG-1.4' || sigBgModel === 'document-advanced' ? 'isnet' : sigBgModel;
        const bgConfig: Config = { model: fallbackModel as any, output: { format: "image/png" } }
        
        const blob = await removeBackground(imageUrl, bgConfig) 
        saveHistory();
        updateSignature(sigId, { imageUrl: URL.createObjectURL(blob) })
      }
      showToast('Signature background removed')
    } catch (e) {
      alert("Background removal failed.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const handleEnhanceSig = async (sigId: string, imageUrl: string) => {
    if (!imageUrl) return
    setIsProcessing(true)
    setLoadingText('Enhancing Signature...')
    await new Promise(r => setTimeout(r, 50))

    try {
      const img = await createImage(imageUrl)
      const cvs = document.createElement('canvas')
      cvs.width = img.width; cvs.height = img.height
      const ctx = cvs.getContext('2d')!
      ctx.filter = 'contrast(200%) brightness(80%) grayscale(100%)'
      ctx.drawImage(img, 0, 0)
      saveHistory();
      updateSignature(sigId, { imageUrl: cvs.toDataURL('image/png') })
      showToast('Signature enhanced')
    } catch (e) {
      alert("Enhancement failed.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  // Drag Placement Handlers
  const handlePointerDownSig = (e: React.PointerEvent, ctx: 'right' | 'modal', sigId: string) => { 
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    saveHistory(); 
    setIsDraggingSig(true); 
    setDraggingContext(ctx); 
    setDraggingSigId(sigId); 
    setActiveSigId(sigId); 
    setOpenMenuSigId(null);
  }

  const handlePointerUpSig = () => { 
    setIsDraggingSig(false); 
    setDraggingContext(null); 
    setResizingState(null); 
    setDraggingSigId(null); 
  }
  
  const handleResizeDown = (e: React.PointerEvent, corner: string, ctx: 'right' | 'modal', sigId: string) => {
    e.stopPropagation() 
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    const sig = signatures.find(s => s.id === sigId)
    if (!sig) return;
    saveHistory(); 
    setResizingState({
      startX: e.clientX,
      startY: e.clientY,
      startScale: getSigPlacement(sig, previewPageIndex).scale,
      corner,
      sigId
    })
    setDraggingContext(ctx)
    setActiveSigId(sigId)
    setOpenMenuSigId(null)
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
      updateSigPlacement(resizingState.sigId, previewPageIndex, { scale: newScale })
      return
    }

    if (isDraggingSig && draggingSigId) {
      const ref = draggingContext === 'right' ? rightSideSigRef : modalSigRef
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      let x = ((e.clientX - rect.left) / rect.width) * 100
      let y = ((e.clientY - rect.top) / rect.height) * 100
      x = Math.max(0, Math.min(100, x))
      y = Math.max(0, Math.min(100, y))
      updateSigPlacement(draggingSigId, previewPageIndex, { x, y })
    }
  }

  const renderSignatureOverlay = (ctx: 'right' | 'modal') => {
    if (!signatures || signatures.length === 0) return null;
    const isPreview = fullScreenMode === 'preview';

    return signatures.filter(sig => shouldApplySignature(previewPageIndex, sig.applyMode, sig.customPages)).map(sig => {
      const placement = getSigPlacement(sig, previewPageIndex)
      const isActive = activeSigId === sig.id && !isPreview;
      const sigIndex = signatures.findIndex(s => s.id === sig.id);
      
      return (
        <div 
          key={sig.id}
          className="absolute transition-opacity duration-75 z-20"
          style={{
            left: `${placement.x}%`,
            top: `${placement.y}%`,
            transform: 'translate(-50%, -50%)',
            opacity: placement.opacity / 100,
            pointerEvents: isPreview ? 'none' : 'auto'
          }}
        >
          <div className="relative pointer-events-auto group" onPointerDown={(e) => { if (!isPreview) { e.stopPropagation(); handlePointerDownSig(e, ctx, sig.id); } }}>
            {sig.mode === 'text' ? (
              <span style={{ fontFamily: sig.font, color: sig.color, fontSize: `${(placement.scale / 100) * 3}rem`, whiteSpace: 'nowrap', display: 'block', padding: '4px' }}>
                {sig.text || ' '}
              </span>
            ) : sig.imageUrl ? (
              <img src={sig.imageUrl} alt="Sig" style={{ width: `${placement.scale * 3}px`, maxWidth: 'none' }} className="mix-blend-multiply block pointer-events-none max-w-none" />
            ) : (
              <div style={{ width: `${placement.scale * 3}px`, height: '40px' }} /> 
            )}
            
            <div className={`absolute inset-0 border-2 border-dashed ${(isDraggingSig || resizingState?.sigId === sig.id) && draggingContext === ctx && isActive ? 'border-blue-500 bg-blue-500/10' : isActive ? 'border-blue-300' : 'border-transparent hover:border-slate-300'} rounded pointer-events-none transition-colors`} style={{ display: isPreview ? 'none' : 'block' }} />
            
            {isActive && (
               <div className="absolute -top-10 right-0 z-30 flex items-center gap-1">
                  <div className="px-2 py-1.5 bg-[#6384A3] text-white text-[10px] font-bold rounded shadow-lg pointer-events-none uppercase tracking-widest whitespace-nowrap">
                    Sig {sigIndex + 1}
                  </div>
                  <button 
                    onPointerDown={(e) => { e.stopPropagation(); setOpenMenuSigId(openMenuSigId === sig.id ? null : sig.id); }} 
                    className="p-1.5 bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 rounded shadow-lg pointer-events-auto transition-colors"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  
                  {openMenuSigId === sig.id && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden flex flex-col py-1 pointer-events-auto">
                      <button 
                        onPointerDown={(e) => { e.stopPropagation(); syncPlacementToAllPages(sig.id, previewPageIndex); setOpenMenuSigId(null); }} 
                        className="px-3 py-2 text-[10px] font-bold text-slate-700 uppercase tracking-widest hover:bg-slate-50 text-left flex items-center gap-2"
                      >
                        <Layers className="w-3.5 h-3.5" /> Apply on all pages
                      </button>
                      <button 
                        onPointerDown={(e) => { e.stopPropagation(); addNewSignature(); setOpenMenuSigId(null); }} 
                        className="px-3 py-2 text-[10px] font-bold text-slate-700 uppercase tracking-widest hover:bg-slate-50 text-left flex items-center gap-2 border-t border-slate-100"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add more signature
                      </button>
                      <button 
                        onPointerDown={(e) => { e.stopPropagation(); removeSignature(sig.id); setOpenMenuSigId(null); }} 
                        className="px-3 py-2 text-[10px] font-bold text-red-600 uppercase tracking-widest hover:bg-red-50 text-left flex items-center gap-2 border-t border-slate-100"
                      >
                        <Trash className="w-3.5 h-3.5" /> Delete signature
                      </button>
                    </div>
                  )}
               </div>
            )}
            
            {isActive && (
              <>
                <div className="absolute -top-3 -left-3 w-6 h-6 lg:w-4 lg:h-4 bg-white border-2 border-blue-500 rounded-full cursor-nwse-resize pointer-events-auto transition-opacity" onPointerDown={(e) => handleResizeDown(e, 'tl', ctx, sig.id)} />
                <div className="absolute -top-3 -right-3 w-6 h-6 lg:w-4 lg:h-4 bg-white border-2 border-blue-500 rounded-full cursor-nesw-resize pointer-events-auto transition-opacity" onPointerDown={(e) => handleResizeDown(e, 'tr', ctx, sig.id)} />
                <div className="absolute -bottom-3 -left-3 w-6 h-6 lg:w-4 lg:h-4 bg-white border-2 border-blue-500 rounded-full cursor-nesw-resize pointer-events-auto transition-opacity" onPointerDown={(e) => handleResizeDown(e, 'bl', ctx, sig.id)} />
                <div className="absolute -bottom-3 -right-3 w-6 h-6 lg:w-4 lg:h-4 bg-white border-2 border-blue-500 rounded-full cursor-nwse-resize pointer-events-auto transition-opacity" onPointerDown={(e) => handleResizeDown(e, 'br', ctx, sig.id)} />
              </>
            )}
          </div>
        </div>
      )
    })
  }

  const renderPaginationOverlay = () => {
    if (pages.length <= 1) return null;
    return (
      <div className="absolute bottom-4 right-4 z-50 flex items-center gap-2 md:gap-4 bg-white/95 backdrop-blur shadow-xl px-4 py-2 rounded-full border border-slate-200 pointer-events-auto">
        <button 
          onClick={(e) => { e.stopPropagation(); setShowViewerGrid(!showViewerGrid) }}
          className={`p-1.5 rounded-full transition-colors ${showViewerGrid ? 'bg-[#6384A3] text-white' : 'hover:bg-slate-200 text-slate-700'}`}
          title="Toggle Grid View"
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

  // --- PANEL RENDERERS ---
  const renderAccordion = (id: PanelId, label: string, icon: React.ReactNode, content: React.ReactNode) => {
    return (
      <div ref={(el) => { if (id) panelRefs.current[id] = el; }} className={`border border-slate-200 flex-shrink-0 bg-white shadow-sm transition-all relative ${activePanel === id ? 'rounded-lg z-20' : 'rounded-lg z-0 overflow-hidden'}`}>
        <button onClick={() => setActivePanel(activePanel === id ? null : id)} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activePanel === id ? 'rounded-t-lg border-b border-slate-100' : 'rounded-lg'}`}>
          {icon} {label}
        </button>
        {activePanel === id && (
          <div className="p-4 bg-white rounded-b-lg">
            {content}
          </div>
        )}
      </div>
    )
  }

  const renderMergeControls = () => (
    <div className="space-y-4">
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
  )

  const renderSplitControls = () => (
    <div className="space-y-4">
      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Ranges to extract (e.g. 1-2, 5, 8-10)</p>
      <input type="text" placeholder="1-3, 5-6" value={splitRanges} onChange={(e) => setSplitRanges(e.target.value)} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" />
      <button onClick={handleSplitPdf} disabled={isProcessing || pages.length === 0} className="w-full py-2 bg-slate-800 text-white font-bold text-[10px] uppercase tracking-widest rounded-lg hover:bg-black transition-colors shadow-sm">
        Download Split ZIP
      </button>
    </div>
  )

  const renderPageEditControls = () => {
    const page = pages[previewPageIndex];
    if (!page) return <p className="text-xs text-slate-500">No page selected</p>;

    return (
      <div className="space-y-5 animate-in fade-in">
        <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-100">
          <SliderControl 
            label="Rotation" 
            value={page.fineRotation} 
            min={-45} max={45} step={0.5} 
            onPointerDown={() => { saveHistory(); setIsStraightening(true); }}
            onPointerUp={() => setIsStraightening(false)}
            onChange={(v) => updatePageAttributes(page.id, { fineRotation: v })} 
            unit="°" 
          />
          <SliderControl 
            label="Zoom" 
            value={page.scale} 
            min={0.5} max={3} step={0.05} 
            onPointerDown={saveHistory} 
            onChange={(v) => updatePageAttributes(page.id, { scale: v })} 
            unit="x" 
          />
        </div>

        <div className="pb-4 border-b border-slate-100">
          <h4 className="text-[10px] font-bold text-slate-800 uppercase tracking-widest mb-3">Color Adjustments</h4>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <SliderControl label="Exposure" value={page.brightness} min={-100} max={100} onPointerDown={saveHistory} onChange={(v) => updatePageAttributes(page.id, { brightness: v })} />
            <SliderControl label="Contrast" value={page.contrast} min={-100} max={100} onPointerDown={saveHistory} onChange={(v) => updatePageAttributes(page.id, { contrast: v })} />
            <SliderControl label="Saturation" value={page.saturation} min={-100} max={100} onPointerDown={saveHistory} onChange={(v) => updatePageAttributes(page.id, { saturation: v })} />
            <SliderControl label="Warmth" value={page.sepia} min={0} max={100} onPointerDown={saveHistory} onChange={(v) => updatePageAttributes(page.id, { sepia: v })} />
            <SliderControl label="Hue" value={page.hue} min={-180} max={180} onPointerDown={saveHistory} onChange={(v) => updatePageAttributes(page.id, { hue: v })} unit="°" />
            <SliderControl label="Sharpen" value={page.sharpen} min={0} max={100} onPointerDown={saveHistory} onChange={(v) => updatePageAttributes(page.id, { sharpen: v })} />
          </div>
          
          <label className="flex items-center gap-2 mt-4 text-[10px] font-bold text-slate-700 uppercase tracking-widest cursor-pointer">
            <input type="checkbox" checked={page.grayscale} onChange={(e) => { saveHistory(); updatePageAttributes(page.id, { grayscale: e.target.checked }) }} className="w-3.5 h-3.5 accent-[#6384A3] rounded" />
            Black & White Filter
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-700 uppercase tracking-widest block">AI Background Removal</label>
          <CustomDropdown 
            value={pageBgModel} 
            onChange={setPageBgModel} 
            direction="up"
            options={[
              { value: 'document-advanced', label: 'Color Document Cleaner (Best)' },
              { value: 'briaai/RMBG-1.4', label: 'Pro AI' },
              { value: 'isnet_fp16', label: 'Standard AI' },
              { value: 'isnet', label: 'Max Detail' }
            ]} 
          />
          <button 
            onClick={() => handleRemovePageBg(page.id, page.url)} 
            disabled={isProcessing} 
            className="w-full py-2 bg-[#6384A3]/10 text-[#6384A3] border border-[#6384A3]/20 font-bold text-[9px] uppercase tracking-widest rounded hover:bg-[#6384A3]/20 transition-colors flex items-center justify-center gap-2 mt-2"
          >
            <Wand2 className="w-3 h-3" /> Remove Background
          </button>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <button 
            onClick={() => {
              saveHistory();
              updatePageAttributes(page.id, { url: page.originalUrl, fineRotation: 0, scale: 1, brightness: 0, contrast: 0, sharpen: 0, saturation: 0, hue: 0, sepia: 0, grayscale: false });
              showToast('Page reset to original');
            }} 
            className="w-full py-2 px-4 text-xs font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50 uppercase tracking-widest transition-colors"
          >
            Reset to Original
          </button>
        </div>
      </div>
    );
  }

  const renderSignatureControls = (context: 'sidebar' | 'modal') => (
    <div className="space-y-4 animate-in fade-in w-full">
      {signatures.length > 0 && signatures.map((sig, sigIndex) => {
        const currentPlacement = getSigPlacement(sig, previewPageIndex)
        return (
          <div key={sig.id} className={`border rounded-lg overflow-hidden transition-all ${activeSigId === sig.id ? 'border-[#6384A3] shadow-sm' : 'border-slate-200'}`}>
            <div 
              className={`p-3 flex justify-between items-center cursor-pointer ${activeSigId === sig.id ? 'bg-blue-50' : 'bg-slate-50 hover:bg-slate-100'}`}
              onClick={() => setActiveSigId(sig.id)}
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">
                Signature {sigIndex + 1}
              </span>
              <button onClick={(e) => { e.stopPropagation(); removeSignature(sig.id); }} className="text-slate-400 hover:text-red-500">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            {activeSigId === sig.id && (
              <div className="p-3 bg-white space-y-4 border-t border-slate-100">
                <div className="flex bg-slate-100 p-1 rounded">
                  <button onClick={() => { saveHistory(); updateSignature(sig.id, { mode: 'text' }) }} className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-widest rounded ${sig.mode === 'text' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>Text</button>
                  <button onClick={() => { saveHistory(); updateSignature(sig.id, { mode: 'image' }) }} className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-widest rounded ${sig.mode === 'image' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>Image</button>
                </div>

                {sig.mode === 'text' && (
                  <div className="space-y-3">
                    <input type="text" value={sig.text} onFocus={saveHistory} onChange={(e) => updateSignature(sig.id, { text: e.target.value })} className="w-full p-2 border border-slate-200 rounded text-sm bg-white" placeholder="Type name..." />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Font Style</label>
                        <CustomDropdown 
                          value={sig.font} 
                          onChange={(val) => { saveHistory(); updateSignature(sig.id, { font: val }) }} 
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
                          <input type="color" value={sig.color} onFocus={saveHistory} onChange={(e) => updateSignature(sig.id, { color: e.target.value })} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0 flex-shrink-0" />
                          <span className="text-[10px] font-mono font-bold text-slate-500 truncate">{sig.color.toUpperCase()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {sig.mode === 'image' && (
                  <div className="space-y-3">
                    <button onClick={() => document.getElementById(`sig-upload-${sig.id}`)?.click()} className="w-full py-2 bg-slate-50 border border-slate-200 text-slate-600 font-bold text-[10px] uppercase tracking-widest rounded hover:bg-slate-100 flex items-center justify-center gap-2">
                      <ImageIcon className="w-3 h-3" /> Upload Image
                    </button>
                    <input type="file" id={`sig-upload-${sig.id}`} accept="image/*" className="hidden" onChange={(e) => handleSigImageUpload(sig.id, e)} />
                    
                    {sig.imageUrl && (
                      <div className="space-y-2 mt-2">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">AI Model</label>
                        <CustomDropdown 
                          value={sigBgModel} 
                          onChange={setSigBgModel} 
                          direction="up"
                          options={[
                            { value: 'document-advanced', label: 'Color Document Cleaner (Best)' },
                            { value: 'briaai/RMBG-1.4', label: 'Pro AI' },
                            { value: 'isnet_fp16', label: 'Standard AI' },
                            { value: 'isnet', label: 'Max Detail' }
                          ]} 
                        />
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button onClick={() => handleRemoveSigBg(sig.id, sig.imageUrl!)} disabled={isProcessing} className="py-2 bg-[#6384A3]/10 text-[#6384A3] border border-[#6384A3]/20 font-bold text-[9px] uppercase tracking-widest rounded hover:bg-[#6384A3]/20 transition-colors">
                            Remove BG
                          </button>
                          <button onClick={() => handleEnhanceSig(sig.id, sig.imageUrl!)} disabled={isProcessing} className="py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold text-[9px] uppercase tracking-widest rounded hover:bg-indigo-100 transition-colors flex justify-center items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Enhance
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Positioning & Scale */}
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      <span>Scale (Page {previewPageIndex + 1})</span><span>{Math.round(currentPlacement.scale)}%</span>
                    </div>
                    <input type="range" min="10" max="200" value={currentPlacement.scale} onPointerDown={saveHistory} onChange={(e) => updateSigPlacement(sig.id, previewPageIndex, { scale: Number(e.target.value) })} className="w-full accent-[#6384A3]" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      <span>Opacity (Page {previewPageIndex + 1})</span><span>{currentPlacement.opacity}%</span>
                    </div>
                    <input type="range" min="10" max="100" value={currentPlacement.opacity} onPointerDown={saveHistory} onChange={(e) => updateSigPlacement(sig.id, previewPageIndex, { opacity: Number(e.target.value) })} className="w-full accent-[#6384A3]" />
                  </div>
                  
                  <div className="space-y-1 pt-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Apply To</label>
                    <CustomDropdown 
                      value={sig.applyMode} 
                      onChange={(val) => { saveHistory(); updateSignature(sig.id, { applyMode: val as 'all' | 'custom' }); }} 
                      direction="up"
                      options={[
                        { value: 'all', label: 'All Pages' },
                        { value: 'custom', label: 'Custom Pages' }
                      ]} 
                    />
                    {sig.applyMode === 'custom' && (
                      <input 
                        type="text" 
                        placeholder="e.g. 1-3, 5, 8" 
                        value={sig.customPages} 
                        onFocus={saveHistory}
                        onChange={(e) => updateSignature(sig.id, { customPages: e.target.value })} 
                        className="w-full p-2 mt-2 border border-slate-200 rounded text-sm bg-white" 
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button onClick={addNewSignature} className="w-full py-2.5 bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[10px] uppercase tracking-widest rounded hover:bg-slate-200 flex items-center justify-center gap-2">
        <Plus className="w-3.5 h-3.5" /> Add Signature
      </button>

      {context === 'sidebar' && !fullScreenMode && pages.length > 0 && (
        <button onClick={enterFullscreen} disabled={pages.length === 0} className="w-full py-2.5 bg-slate-800 text-white font-bold text-[10px] uppercase tracking-widest rounded-lg hover:bg-black transition-colors shadow-sm flex items-center justify-center gap-2 mt-2">
          <Move className="w-3.5 h-3.5" /> Open Full Screen
        </button>
      )}
    </div>
  )

  const renderEnhanceControls = () => (
    <div className="space-y-4">
      <label className="flex items-start gap-2 text-xs font-bold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={cleanWatermarks} onChange={(e) => { setCleanWatermarks(e.target.checked); showToast(e.target.checked ? 'Global scan cleaner enabled' : 'Global scan cleaner disabled'); }} className="w-4 h-4 mt-0.5 accent-[#6384A3] rounded" />
        <div>
          <span className="uppercase tracking-wider">Remove Faint Watermarks</span>
          <p className="text-[9px] text-slate-400 font-normal mt-1 leading-tight">Washes out light colors, shadows, and faint watermarks while preserving dark text for scanned documents globally.</p>
        </div>
      </label>
      <p className="text-[10px] text-[#6384A3] font-bold mt-2 pt-2 border-t border-slate-100">Pro Tip: Use 'Page Settings' for local AI background removal.</p>
    </div>
  )

  const renderSecurityControls = () => (
    <div className="space-y-4">
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
  )

  const renderOverlayControls = () => (
    <div className="space-y-4">
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
  )

  const renderCompressionControls = () => (
    <div className="space-y-4">
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

      {/* Size Estimator */}
      {estimatedSizes && (
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2 text-center animate-in fade-in">
          <div className="bg-slate-50 p-2 rounded border border-slate-200">
            <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Current Size</span>
            <span className="text-xs font-bold text-slate-700">{estimatedSizes.original}</span>
          </div>
          <div className="bg-blue-50 p-2 rounded border border-blue-100">
            <span className="block text-[9px] font-bold text-blue-500 uppercase tracking-widest mb-1">Output Est.</span>
            <span className="text-xs font-bold text-blue-700">{estimatedSizes.compressed}</span>
          </div>
        </div>
      )}
    </div>
  )

  const renderExportControls = () => (
    <div className="space-y-4">
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
  )

  const renderSidebarAccordions = (isForFullscreen: boolean) => {
    return (
      <div className="space-y-3">
        {!isForFullscreen && renderAccordion('merge', 'Merge Documents', <Layers className="w-4 h-4 text-[#6384A3]"/>, renderMergeControls())}
        {!isForFullscreen && renderAccordion('split', 'Split Document', <Scissors className="w-4 h-4 text-[#6384A3]"/>, renderSplitControls())}
        
        {pages.length > 0 && renderAccordion('page-edit', 'Page Settings', <Edit3 className="w-4 h-4 text-[#6384A3]"/>, renderPageEditControls())}
        {renderAccordion('signature', 'Signature Studio', <PenTool className="w-4 h-4 text-[#6384A3]"/>, renderSignatureControls(isForFullscreen ? 'modal' : 'sidebar'))}
        {renderAccordion('enhance', 'Scan Cleaner (Global)', <Wand2 className="w-4 h-4 text-[#6384A3]"/>, renderEnhanceControls())}
        
        {!isForFullscreen && renderAccordion('security', 'Security & Passwords', <ShieldCheck className="w-4 h-4 text-[#6384A3]"/>, renderSecurityControls())}
        
        {renderAccordion('overlays', 'Text Overlays', <Type className="w-4 h-4 text-[#6384A3]"/>, renderOverlayControls())}
        {renderAccordion('compression', 'Doc Compression', <SlidersHorizontal className="w-4 h-4 text-[#6384A3]"/>, renderCompressionControls())}
        {!isForFullscreen && renderAccordion('export', 'Format & Export', <Download className="w-4 h-4 text-[#6384A3]"/>, renderExportControls())}
      </div>
    )
  }

  // --- CORE CANVAS RENDERING FOR EXPORT ---
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
    
    const b = 100 + (page.brightness ?? 0)
    const c = 100 + (page.contrast ?? 0)
    const sat = 100 + (page.saturation ?? 0)
    const hue = page.hue ?? 0
    const sep = Math.max(0, page.sepia ?? 0)
    const gray = page.grayscale ? 100 : 0
    
    ctx.filter = `brightness(${b}%) contrast(${c}%) saturate(${sat}%) hue-rotate(${hue}deg) grayscale(${gray}%) sepia(${sep}%)`;

    const scaleX = scaleRatio * (page.scale || 1)
    const scaleY = scaleRatio * (page.scale || 1)
    ctx.scale(scaleX, scaleY)
    
    ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.filter = 'none'

    // Clean Scan (Thresholding - Global Only)
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

    // Global Grayscale Compression Override
    if (forPdf && enableCompression && compressionGrayscale) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imgData.data
      for (let j = 0; j < data.length; j += 4) {
        const luma = data[j] * 0.299 + data[j+1] * 0.587 + data[j+2] * 0.114
        data[j] = luma; data[j+1] = luma; data[j+2] = luma
      }
      ctx.putImageData(imgData, 0, 0)
    }

    // Manual JS Sharpening for Output Context
    if ((page.sharpen ?? 0) > 0) {
      const amount = page.sharpen / 100;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const w = canvas.width;
      const h = canvas.height;
      const copy = new Uint8ClampedArray(data);
      const k1 = -amount;
      const k4 = 1 + 4 * amount;
      
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const px = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            const val = 
              k1 * copy[px - w * 4 + c] +
              k1 * copy[px - 4 + c] +
              k4 * copy[px + c] +
              k1 * copy[px + 4 + c] +
              k1 * copy[px + w * 4 + c];
            data[px + c] = val;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // Signatures Overlay
    if (!skipSignature && signatures && signatures.length > 0) {
      for (const sig of signatures) {
        if (shouldApplySignature(index, sig.applyMode, sig.customPages)) {
          const placement = getSigPlacement(sig, index)
          ctx.save()
          ctx.globalAlpha = placement.opacity / 100
          const sigX = (placement.x / 100) * canvas.width
          const sigY = (placement.y / 100) * canvas.height

          if (sig.mode === 'text' && sig.text) {
            const fontSize = (placement.scale / 100) * canvas.width * 0.1
            ctx.font = `${fontSize}px ${sig.font}`
            ctx.fillStyle = sig.color
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(sig.text, sigX, sigY)
          } else if (sig.mode === 'image' && sig.imageUrl) {
            const sigImg = await createImage(sig.imageUrl)
            const baseSigWidth = canvas.width * 0.3
            const drawWidth = baseSigWidth * (placement.scale / 50)
            const drawHeight = (sigImg.height / sigImg.width) * drawWidth
            ctx.drawImage(sigImg, sigX - drawWidth / 2, sigY - drawHeight / 2, drawWidth, drawHeight)
          }
          ctx.restore()
        }
      }
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
      let x = canvas.width / 2; let y = canvas.height / 2;
      let align: CanvasTextAlign = 'center'; let baseline: CanvasTextBaseline = 'middle'; let angle = -Math.PI / 4;
      const padding = fontSize

      if (watermarkPlacement === 'top-left') { x = padding; y = padding; align = 'left'; baseline = 'top'; angle = 0; }
      else if (watermarkPlacement === 'top-right') { x = canvas.width - padding; y = padding; align = 'right'; baseline = 'top'; angle = 0; }
      else if (watermarkPlacement === 'bottom-left') { x = padding; y = canvas.height - padding; align = 'left'; baseline = 'bottom'; angle = 0; }
      else if (watermarkPlacement === 'bottom-right') { x = canvas.width - padding; y = canvas.height - padding; align = 'right'; baseline = 'bottom'; angle = 0; }

      ctx.translate(x, y); ctx.rotate(angle); ctx.textAlign = align; ctx.textBaseline = baseline;
      ctx.fillText(watermarkText, 0, 0); ctx.setTransform(1, 0, 0, 1, 0, 0);
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

  // --- NEW: MISSING EXPORT FUNCTIONS ADDED HERE ---
  const exportAsPdf = async () => {
    setIsProcessing(true)
    setLoadingText('Generating PDF...')
    await new Promise(r => setTimeout(r, 50))
    try {
      const blob = await generatePdfBlob()
      if (blob) {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${originalDocName}_zs_converter.pdf`
        link.click()
        URL.revokeObjectURL(url)
        showToast('PDF exported successfully')
      }
    } catch (e) {
      alert("PDF export failed.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const exportAsImages = async () => {
    setIsProcessing(true)
    setLoadingText('Generating Image Archive...')
    await new Promise(r => setTimeout(r, 50))
    try {
      const zip = new JSZip()
      for (let i = 0; i < pages.length; i++) {
        const canvas = await renderPageToCanvas(pages[i], i, false)
        if (!canvas) continue

        const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
        // Extract base64 part
        const base64Data = dataUrl.split(',')[1]
        zip.file(`${originalDocName}_page_${i + 1}.jpg`, base64Data, { base64: true })
      }

      const zipContent = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipContent)
      const link = document.createElement('a')
      link.href = url
      link.download = `${originalDocName}_images_zs_converter.zip`
      link.click()
      URL.revokeObjectURL(url)
      showToast('Image archive exported')
    } catch (e) {
      alert("Image export failed.")
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  const exportAsWord = async () => {
    setIsProcessing(true)
    setLoadingText('Building Word Document...')
    await new Promise(r => setTimeout(r, 50))
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
      showToast('Word document exported')
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
    await new Promise(r => setTimeout(r, 50))
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
      showToast('Split PDF downloaded')
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

  return (
    <>
      {/* SVG Filters (Global defs for CSS Sharpening) */}
      <svg style={{ display: 'none' }}>
        <defs>
          {pages.map(p => {
            if ((p.sharpen ?? 0) > 0) {
              const amount = p.sharpen / 100;
              const center = 1 + 4 * amount;
              const edge = -amount;
              return (
                <filter key={`sharpen-filter-${p.id}`} id={`sharpen-${p.id}`}>
                  <feConvolveMatrix 
                    order="3 3" 
                    preserveAlpha="true" 
                    kernelMatrix={`0 ${edge} 0 ${edge} ${center} ${edge} 0 ${edge} 0`} 
                  />
                </filter>
              )
            }
            return null;
          })}
        </defs>
      </svg>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px]">
        
        {/* Sidebar Settings */}
        <div className="w-full lg:w-80 h-auto lg:h-full flex flex-col bg-slate-50 border-b lg:border-b-0 lg:border-r border-slate-200 order-2 lg:order-1 relative">
          <div className="p-4 lg:p-6 pb-2 border-b border-slate-200 flex-shrink-0 z-10 bg-slate-50 flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Doc Settings
            </h4>
            <button onClick={handleUndo} disabled={history.length === 0} className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent" title="Undo">
              <Undo2 className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto p-4 lg:p-6 pt-4 pb-4">
            {renderSidebarAccordions(false)}
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
        <div className="flex-1 overflow-hidden relative touch-none w-full h-full flex items-center justify-center bg-slate-100 order-1 lg:order-2">
          {pages.length === 0 ? (
            <div className="p-4 lg:p-8 w-full h-full flex flex-col">
              <div {...getRootProps()} className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl cursor-pointer transition-colors p-6 text-center ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-white bg-slate-50'}`}>
                <input {...getInputProps()} />
                <FileText className="w-10 h-10 lg:w-12 lg:h-12 mb-4 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-700">Drag & drop PDFs or Images here</h3>
                <p className="text-xs text-slate-500 mt-1">Pro Tip: Drop multiple files to merge them</p>
              </div>
            </div>
          ) : (
            <>
              {/* Static overlay tools for single page view */}
              {!showViewerGrid && sigPageTarget && (
                <div className="absolute top-4 left-4 z-50 flex gap-2 pointer-events-auto opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => { e.stopPropagation(); rotatePage(sigPageTarget.id) }} 
                    className="bg-slate-800 text-white p-2.5 rounded-full shadow-lg hover:bg-black transition-transform hover:scale-105"
                    title="Rotate 90°"
                  >
                    <RotateCw className="w-4 h-4"/>
                  </button>
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      removePage(sigPageTarget.id);
                      if (pages.length <= 1) setShowViewerGrid(true); 
                    }} 
                    className="bg-red-500 text-white p-2.5 rounded-full shadow-lg hover:bg-red-600 transition-transform hover:scale-105"
                    title="Delete Page"
                  >
                    <Trash2 className="w-4 h-4"/>
                  </button>
                </div>
              )}

              {!showViewerGrid && (
                <div className="absolute top-4 right-4 z-50 pointer-events-auto">
                  <button
                    onClick={enterFullscreen}
                    className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg shadow-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-slate-200 transition-transform hover:scale-105"
                    title="Open Full Screen"
                  >
                    <Move className="w-3.5 h-3.5" /> Full Screen
                  </button>
                </div>
              )}

              {showViewerGrid ? (
                <div className="absolute inset-0 z-40 bg-slate-100 overflow-y-auto px-6 py-20 custom-scrollbar">
                  <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                      {pages.length} {pages.length === 1 ? 'Page' : 'Pages'} Loaded
                    </span>
                    <button onClick={clearAll} className="text-[10px] font-bold text-red-500 hover:text-red-700 uppercase tracking-widest transition-colors flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Clear All
                    </button>
                  </div>
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
                            saturation={page.saturation}
                            hue={page.hue}
                            sepia={page.sepia}
                            sharpen={page.sharpen || 0}
                            grayscale={page.grayscale}
                            watermarkText={watermarkText}
                            watermarkPlacement={watermarkPlacement}
                            watermarkOpacity={watermarkOpacity}
                            addPageNumbers={addPageNumbers}
                            totalPages={pages.length}
                            onRemove={removePage} 
                            onRotate={rotatePage}
                            onView={(id) => {
                              const idx = pages.findIndex(p => p.id === id);
                              if(idx !== -1) {
                                setPreviewPageIndex(idx);
                                setShowViewerGrid(false);
                              }
                            }}
                          />
                        ))}
                        
                        <div {...getRootProps()} className={`aspect-[3/4] border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors p-2 text-center ${isDragActive ? 'border-[#6384A3] bg-blue-50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-white bg-slate-50'}`}>
                          <input {...getInputProps()} />
                          <span className="text-2xl text-slate-400 font-light mb-1">+</span>
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Merge File</span>
                        </div>
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              ) : (
                sigPageTarget && (
                  <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                    <div 
                      ref={rightSideSigRef}
                      className="relative touch-none inline-flex items-center justify-center"
                      onPointerDown={() => setOpenMenuSigId(null)}
                      onPointerMove={handlePointerMoveSig}
                      onPointerUp={handlePointerUpSig}
                      onPointerCancel={handlePointerUpSig}
                      style={{
                         transform: `scale(${0.75})`,
                         transition: 'transform 0.15s ease-out'
                      }}
                    >
                       <div 
                         className="relative flex items-center justify-center shadow-xl"
                         style={{
                           transform: `rotate(${sigPageTarget.rotation + (sigPageTarget.fineRotation || 0)}deg) scale(${activePanel === 'page-edit' ? sigPageTarget.scale || 1 : 1})`,
                           transition: 'transform 0.15s ease-out'
                         }}
                       >
                         <img 
                           src={sigPageTarget.url} 
                           className="block pointer-events-none bg-white w-auto h-auto object-contain" 
                           style={{ 
                             maxHeight: '75vh', 
                             maxWidth: '80vw',
                             filter: getFilterString(sigPageTarget)
                           }}
                           alt="Preview" 
                           draggable={false}
                         />
                         
                         <div className="absolute inset-0 pointer-events-none">
                           {renderSignatureOverlay('right')}
                         </div>
                       </div>
                    </div>

                    {/* Watermark Overlay in Non-Fullscreen Preview */}
                    {watermarkText && (
                      <div className="absolute inset-0 pointer-events-none overflow-hidden z-30 flex items-center justify-center" style={{ opacity: watermarkOpacity / 100 }}>
                         <div 
                           className={`absolute font-bold text-slate-500 whitespace-nowrap opacity-50 ${
                             watermarkPlacement === 'center' ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-4xl sm:text-6xl' :
                             watermarkPlacement === 'top-left' ? 'top-6 left-6 text-xl' :
                             watermarkPlacement === 'top-right' ? 'top-6 right-6 text-xl' :
                             watermarkPlacement === 'bottom-left' ? 'bottom-12 left-6 text-xl' :
                             'bottom-12 right-6 text-xl'
                           }`}
                         >
                           {watermarkText}
                         </div>
                      </div>
                    )}
                    
                    {addPageNumbers && (
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 text-slate-800 font-bold text-sm pointer-events-none">
                        {previewPageIndex + 1} / {pages.length}
                      </div>
                    )}

                    {/* Fixed Axis Lines - Rendered ONLY while straightening */}
                    {activePanel === 'page-edit' && isStraightening && (
                       <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center mix-blend-difference overflow-hidden">
                         <div className="w-full h-[1.5px] bg-amber-500 absolute top-1/2 -translate-y-1/2 opacity-70" />
                         <div className="h-full w-[1.5px] bg-amber-500 absolute left-1/2 -translate-x-1/2 opacity-70" />
                       </div>
                    )}
                  </div>
                )
              )}
              {renderPaginationOverlay()}
            </>
          )}
        </div>
      </div>

      {/* Fullscreen Editor / Universal Workspace Mode */}
      {fullScreenMode && pages.length > 0 && sigPageTarget && (
        <div className="fixed inset-0 z-[160] bg-slate-100 flex flex-col md:flex-row animate-in fade-in duration-200">
          
          {/* Top Right Close Button (Red Highlighted) */}
          <button 
            onClick={() => setFullScreenMode(null)} 
            className="fixed top-6 right-6 z-[300] bg-red-600 text-white p-3 rounded-full shadow-2xl hover:bg-red-500 hover:scale-105 ring-4 ring-red-500/30 transition-all border border-white/20 flex items-center justify-center group"
            title={fullScreenMode === 'preview' ? "Close Preview" : "Close Full Screen"}
          >
            <X className="w-5 h-5 group-hover:rotate-90 transition-transform" />
          </button>

          {/* Settings Sidebar for Fullscreen */}
          <div className="w-full md:w-80 bg-white md:h-full flex flex-col border-b md:border-b-0 md:border-r border-slate-200 overflow-y-auto shrink-0 z-40">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  {fullScreenMode === 'preview' ? <Eye className="w-4 h-4 text-[#6384A3]"/> : <Settings2 className="w-4 h-4 text-[#6384A3]" />} 
                  {fullScreenMode === 'preview' ? 'Document Preview' : 'Full Screen Studio'}
                </h3>
                {fullScreenMode === 'edit' && (
                  <button onClick={handleUndo} disabled={history.length === 0} className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent" title="Undo Last Action">
                    <Undo2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="p-4 space-y-4 overflow-visible flex-1">
              {fullScreenMode === 'preview' ? (
                renderAccordion('export', 'Format & Export', <Download className="w-4 h-4 text-[#6384A3]"/>, renderExportControls())
              ) : (
                renderSidebarAccordions(true)
              )}
            </div>
            <div className="p-4 border-t border-slate-200 bg-slate-50 sticky bottom-0">
              {fullScreenMode === 'preview' ? (
                <button onClick={handleMainExport} disabled={isProcessing} className="w-full py-3 bg-[#6384A3] hover:bg-[#4f6a83] text-white font-bold rounded uppercase tracking-widest text-xs transition-colors shadow-sm flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> Export File
                </button>
              ) : (
                <button onClick={() => setFullScreenMode(null)} className="w-full py-3 bg-slate-800 hover:bg-black text-white font-bold rounded uppercase tracking-widest text-xs transition-colors shadow-sm">
                  Save & Close Studio
                </button>
              )}
            </div>
          </div>
          
          <div className="flex-1 relative touch-none select-none bg-slate-100 overflow-hidden flex flex-col">
              
             {!showViewerGrid && fullScreenMode !== 'preview' && (
               <div className="absolute top-6 left-6 z-50 flex gap-3 pointer-events-auto">
                 <button 
                   onClick={(e) => { e.stopPropagation(); rotatePage(sigPageTarget.id) }} 
                   className="bg-slate-800 text-white p-3 rounded-full shadow-lg hover:bg-black transition-transform hover:scale-105"
                   title="Rotate 90°"
                 >
                   <RotateCw className="w-5 h-5"/>
                 </button>
                 <button 
                   onClick={(e) => { 
                     e.stopPropagation(); 
                     removePage(sigPageTarget.id);
                     if (pages.length <= 1) setShowViewerGrid(true); 
                   }} 
                   className="bg-red-500 text-white p-3 rounded-full shadow-lg hover:bg-red-600 transition-transform hover:scale-105"
                   title="Delete Page"
                 >
                   <Trash2 className="w-5 h-5"/>
                 </button>
               </div>
             )}

             <div className="absolute top-4 right-24 z-50 flex gap-1 bg-slate-800/90 p-1.5 rounded-lg backdrop-blur border border-slate-700 shadow-xl">
               <button onClick={() => setSigZoom(z => Math.max(0.25, z - 0.25))} className="p-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition-colors"><ZoomOut className="w-4 h-4"/></button>
               <div className="flex items-center justify-center px-3 min-w-[4rem] text-xs font-bold text-slate-300 tracking-widest">{Math.round(sigZoom * 100)}%</div>
               <button onClick={() => setSigZoom(z => Math.min(4, z + 0.25))} className="p-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition-colors"><ZoomIn className="w-4 h-4"/></button>
             </div>

             {renderPaginationOverlay()}

             <div className="flex-1 overflow-auto relative w-full h-full z-10 flex items-center justify-center bg-slate-100">
               {showViewerGrid ? (
                 <div className="absolute inset-0 z-40 bg-slate-100 overflow-y-auto px-6 py-20 custom-scrollbar">
                   <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-in fade-in">
                     {pages.map((p, idx) => (
                       <div key={p.id} onClick={() => { setPreviewPageIndex(idx); setShowViewerGrid(false); }} className={`cursor-pointer border-2 rounded-lg overflow-hidden aspect-[3/4] relative transition-colors bg-slate-100 shadow-xl ${previewPageIndex === idx ? 'border-[#6384A3] ring-2 ring-[#6384A3]/50' : 'border-slate-300 hover:border-slate-400'}`}>
                         <img src={p.url} alt={`Thumb ${idx+1}`} className="w-full h-full object-contain bg-white" style={{ transform: `rotate(${p.rotation + p.fineRotation}deg)` }} />
                         
                         {/* Grid Watermarks */}
                         {watermarkText && (
                            <div className="absolute inset-0 pointer-events-none overflow-hidden z-20 flex" style={{ opacity: watermarkOpacity / 100 }}>
                               <div 
                                 className={`absolute font-bold text-slate-500 whitespace-nowrap opacity-50 ${
                                   watermarkPlacement === 'center' ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-xl' :
                                   watermarkPlacement === 'top-left' ? 'top-2 left-2 text-[8px]' :
                                   watermarkPlacement === 'top-right' ? 'top-2 right-2 text-[8px]' :
                                   watermarkPlacement === 'bottom-left' ? 'bottom-6 left-2 text-[8px]' :
                                   'bottom-6 right-2 text-[8px]'
                                 }`}
                               >
                                 {watermarkText}
                               </div>
                            </div>
                          )}

                         <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded z-30">Page {idx + 1}</div>
                         {signatures && signatures.length > 0 && signatures.some(sig => shouldApplySignature(idx, sig.applyMode, sig.customPages)) && (
                           <div className="absolute top-1 right-1 bg-[#6384A3] text-white text-[9px] px-1.5 py-0.5 rounded shadow z-30">Signed</div>
                         )}
                         {addPageNumbers && (
                            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-20 text-slate-800 font-bold text-[8px] pointer-events-none">
                              {idx + 1} / {pages.length}
                            </div>
                          )}
                       </div>
                     ))}
                   </div>
                 </div>
               ) : (
                 <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                   <div 
                     ref={modalSigRef}
                     className="relative touch-none inline-flex items-center justify-center"
                     onPointerDown={() => setOpenMenuSigId(null)}
                     onPointerMove={handlePointerMoveSig}
                     onPointerUp={handlePointerUpSig}
                     onPointerCancel={handlePointerUpSig}
                     style={{
                        transform: `scale(${sigZoom})`,
                        transition: 'transform 0.15s ease-out'
                     }}
                   >
                     {/* The Image Group Container */}
                     <div 
                       className="relative flex items-center justify-center shadow-xl"
                       style={{
                         transform: `rotate(${sigPageTarget.rotation + (sigPageTarget.fineRotation || 0)}deg) scale(${activePanel === 'page-edit' ? sigPageTarget.scale || 1 : 1})`,
                         transition: 'transform 0.15s ease-out'
                       }}
                     >
                       <img 
                         src={sigPageTarget.url} 
                         className="block pointer-events-none bg-white w-auto h-auto object-contain" 
                         style={{ 
                           maxHeight: '75vh', 
                           maxWidth: '80vw',
                           filter: getFilterString(sigPageTarget)
                         }}
                         alt="Preview" 
                         draggable={false}
                       />
                       
                       <div className="absolute inset-0 pointer-events-none">
                         {renderSignatureOverlay('modal')}
                       </div>
                     </div>
                   </div>

                   {/* Watermark Overlay for Fullscreen */}
                   {watermarkText && (
                      <div className="absolute inset-0 pointer-events-none overflow-hidden z-30 flex items-center justify-center" style={{ opacity: watermarkOpacity / 100 }}>
                         <div 
                           className={`absolute font-bold text-slate-500 whitespace-nowrap opacity-50 ${
                             watermarkPlacement === 'center' ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-4xl sm:text-6xl' :
                             watermarkPlacement === 'top-left' ? 'top-6 left-6 text-xl' :
                             watermarkPlacement === 'top-right' ? 'top-6 right-6 text-xl' :
                             watermarkPlacement === 'bottom-left' ? 'bottom-12 left-6 text-xl' :
                             'bottom-12 right-6 text-xl'
                           }`}
                         >
                           {watermarkText}
                         </div>
                      </div>
                    )}
                    
                    {addPageNumbers && (
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 text-slate-800 font-bold text-sm pointer-events-none">
                        {previewPageIndex + 1} / {pages.length}
                      </div>
                    )}

                   {/* Fixed Axis Lines - Rendered ONLY while straightening */}
                   {activePanel === 'page-edit' && isStraightening && fullScreenMode !== 'preview' && (
                      <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center mix-blend-difference overflow-hidden">
                        <div className="w-full h-[1.5px] bg-amber-500 absolute top-1/2 -translate-y-1/2 opacity-70" />
                        <div className="h-full w-[1.5px] bg-amber-500 absolute left-1/2 -translate-x-1/2 opacity-70" />
                      </div>
                   )}
                 </div>
               )}
             </div>
          </div>
        </div>
      )}

      {/* Global Application Loading Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center z-[200]">
          <div className="bg-white px-6 py-4 rounded-xl shadow-2xl flex flex-col items-center">
            <svg className="animate-spin w-8 h-8 text-[#6384A3] mb-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-xs font-bold text-slate-800 uppercase tracking-widest">{loadingText}</p>
          </div>
        </div>
      )}

      {/* Toast Notification Container */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-4 py-2 rounded-full shadow-2xl z-[300] animate-in slide-in-from-bottom-5 fade-in duration-300 text-xs font-bold uppercase tracking-widest flex items-center gap-2 pointer-events-none">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {toast.message}
        </div>
      )}
    </>
  )
}