'use client'

import { useState, useRef, useEffect } from 'react'
import ReactCrop, { Crop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { removeBackground as imglyRemoveBackground, Config } from '@imgly/background-removal'
import { jsPDF } from 'jspdf'
import { Crop as CropIcon, Eraser, Download, Settings2, Image as ImageIcon, Palette, X, Undo2, Sparkles, Wand2, RotateCw, FlipHorizontal, FlipVertical, Square, RefreshCcw, Blend, Type, Maximize } from 'lucide-react'
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

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
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
  
  const [activeTool, setActiveTool] = useState<'crop' | 'bg' | 'enhance' | 'transform' | 'resize' | 'export' | null>('export')
  
  const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name

  const [imgDims, setImgDims] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const img = new Image()
    img.onload = () => setImgDims({ w: img.width, h: img.height })
    img.src = currentImage
  }, [currentImage])

  const [liveTransform, setLiveTransform] = useState({ rotate: 0, flipH: false, flipV: false, radius: 0 })

  const [cropAspect, setCropAspect] = useState<number | undefined>(undefined)
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 50, height: 50, x: 25, y: 25 })
  const [completedCrop, setCompletedCrop] = useState<Crop | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [isRemovingBg, setIsRemovingBg] = useState(false)
  const [selectedModel, setSelectedModel] = useState('briaai/RMBG-1.4')
  const [bgType, setBgType] = useState<'transparent' | 'color' | 'gradient' | 'image'>('transparent')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [bgGradientColor1, setBgGradientColor1] = useState('#6384A3')
  const [bgGradientColor2, setBgGradientColor2] = useState('#feb47b')
  const [bgGradientDir, setBgGradientDir] = useState<string>('to bottom right')
  const [bgImage, setBgImage] = useState<string | null>(null)
  const [bgImageScale, setBgImageScale] = useState<number>(100) 

  const defaultFilters = { b: 100, c: 100, s: 100, sep: 0 }
  const [liveFilters, setLiveFilters] = useState(defaultFilters)

  const [resizeWidth, setResizeWidth] = useState<number | ''>('')
  const [resizeHeight, setResizeHeight] = useState<number | ''>('')
  const [maintainRatio, setMaintainRatio] = useState(true)
  const [presetSize, setPresetSize] = useState('custom')

  // Set exportFormat exactly to original format by default if valid
  const validFormats = ['image/png', 'image/webp', 'image/jpeg', 'image/x-icon', 'application/pdf']
  const [exportFormat, setExportFormat] = useState<string>(validFormats.includes(file.type) ? file.type : 'image/png')
  const [compressionQuality, setCompressionQuality] = useState<number>(85)

  const [estimatedSize, setEstimatedSize] = useState<number | null>(null)
  const [isCalculatingSize, setIsCalculatingSize] = useState(false)

  const pushToGlobalHistory = (newImageUrl: string) => setHistory(prev => [...prev, newImageUrl])
  const handleUndo = () => { if (canUndo) setHistory(prev => prev.slice(0, -1)) }

  // High-Resolution Custom Architecture Background Removal
  const handleRemoveBg = async () => {
    setIsRemovingBg(true)
    try {
      const optimizedDataUrl = await optimizeImageForAI(currentImage)
      let removedSuccessfully = false;

      // Force Manual Architecture Loading for RMBG-1.4
      if (selectedModel === 'briaai/RMBG-1.4') {
        try {
          const { AutoModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
          
          env.allowLocalModels = false; 
          
          // Bypasses the unsupported pipeline crash by loading the weights via custom config
          const model = await AutoModel.from_pretrained(selectedModel, {
            config: { model_type: 'custom' } as any,
          });

          // Inject the exact tensor math parameters RMBG-1.4 needs
          const processor = await AutoProcessor.from_pretrained(selectedModel, {
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
          
          // Generate AI Alpha Matte
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

          // Get Full-Res Original Image
          const originalImg = await createImage(currentImage);
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = originalImg.width;
          finalCanvas.height = originalImg.height;
          const finalCtx = finalCanvas.getContext('2d');
          if (!finalCtx) throw new Error("Final context failed");

          finalCtx.drawImage(originalImg, 0, 0);
          finalCtx.globalCompositeOperation = 'destination-in';
          // Scales the mask flawlessly to the massive original resolution
          finalCtx.drawImage(maskCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
          
          pushToGlobalHistory(finalCanvas.toDataURL('image/png'));
          removedSuccessfully = true;
        } catch (hfError) {
          console.warn("Manual RMBG-1.4 engine failed. Falling back to Imgly...", hfError);
        }
      }

      // Fail-safe Fallback 
      if (!removedSuccessfully) {
        const fallbackModel = selectedModel === 'briaai/RMBG-1.4' ? 'isnet' : selectedModel;
        const bgConfig: Config = { model: fallbackModel as any, output: { format: "image/png" } }
        
        const imageBlob = await imglyRemoveBackground(currentImage, bgConfig) 
        pushToGlobalHistory(URL.createObjectURL(imageBlob))
      }

    } catch (error) {
      console.error("BG Removal Critical Error:", error)
      alert("Failed to remove background. Ensure you have a stable internet connection.")
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
    setActiveTool('export')
    setLiveTransform({ rotate: 0, flipH: false, flipV: false, radius: 0 })
  }

  const handleApplyCrop = async () => {
    if (!imgRef.current || !completedCrop || completedCrop.width === 0 || completedCrop.height === 0) return
    const image = imgRef.current
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scaleX = image.naturalWidth / image.width
    const scaleY = image.naturalHeight / image.height

    canvas.width = completedCrop.width * scaleX
    canvas.height = completedCrop.height * scaleY

    ctx.drawImage(
      image,
      completedCrop.x * scaleX, 
      completedCrop.y * scaleY, 
      completedCrop.width * scaleX, 
      completedCrop.height * scaleY,
      0, 
      0, 
      canvas.width, 
      canvas.height
    )
    pushToGlobalHistory(canvas.toDataURL('image/png'))
    setActiveTool('export')
    setCropAspect(undefined)
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
    setActiveTool('export')
    setLiveFilters(defaultFilters)
  }

  const handleApplyResize = async () => {
    const img = await createImage(currentImage)
    let targetWidth = img.width
    let targetHeight = img.height
    
    const rw = typeof resizeWidth === 'number' ? resizeWidth : null;
    const rh = typeof resizeHeight === 'number' ? resizeHeight : null;

    if (!rw && !rh) {
      setActiveTool('export')
      return
    }

    if (maintainRatio) {
      if (rw && rh) {
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
      targetWidth = rw || img.width;
      targetHeight = rh || img.height;
    }

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
    pushToGlobalHistory(canvas.toDataURL('image/png'))
    setActiveTool('export')
    setPresetSize('custom')
    setResizeWidth('')
    setResizeHeight('')
  }

  const handlePresetChange = (val: string) => {
    setPresetSize(val)
    if (val !== 'custom') {
      const [w, h] = val.split('x').map(Number)
      setResizeWidth(w)
      setResizeHeight(h)
      setMaintainRatio(false) 
    } else {
      setResizeWidth('')
      setResizeHeight('')
    }
  }

  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setBgImage(URL.createObjectURL(e.target.files[0]))
      setBgType('image')
      setBgImageScale(100)
    }
  }

  const drawBackgroundToCanvas = async (ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number) => {
    if (exportFormat === 'image/jpeg' && bgType === 'transparent') {
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvasW, canvasH)
    } else if (bgType === 'color') {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvasW, canvasH)
    } else if (bgType === 'gradient') {
      let x0 = 0, y0 = 0, x1 = canvasW, y1 = canvasH;
      if (bgGradientDir === 'to bottom') {
        x1 = 0;
      } else if (bgGradientDir === 'to right') {
        y1 = 0;
      } else if (bgGradientDir === 'to top right') {
        y0 = canvasH;
        y1 = 0;
      }
      
      const grad = ctx.createLinearGradient(x0, y0, x1, y1)
      grad.addColorStop(0, bgGradientColor1)
      grad.addColorStop(1, bgGradientColor2)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, canvasW, canvasH)
    } else if (bgType === 'image' && bgImage) {
      const bgImgObj = await createImage(bgImage)
      const imgRatio = bgImgObj.width / bgImgObj.height
      const canvasRatio = canvasW / canvasH
      let renderWidth, renderHeight
      
      if (imgRatio > canvasRatio) {
        renderHeight = canvasH
        renderWidth = bgImgObj.width * (renderHeight / bgImgObj.height)
      } else {
        renderWidth = canvasW
        renderHeight = bgImgObj.height * (renderWidth / bgImgObj.width)
      }

      const scale = bgImageScale / 100
      const scaledWidth = renderWidth * scale
      const scaledHeight = renderHeight * scale
      
      const dx = (canvasW - scaledWidth) / 2
      const dy = (canvasH - scaledHeight) / 2
      
      ctx.drawImage(bgImgObj, dx, dy, scaledWidth, scaledHeight)
    }
  }

  const generateOutputBlob = async (): Promise<Blob | null> => {
    const img = await createImage(currentImage)
    const targetWidth = img.width
    const targetHeight = img.height

    if (exportFormat === 'application/pdf') {
      const pdf = new jsPDF({ orientation: targetWidth > targetHeight ? 'landscape' : 'portrait', unit: 'px', format: [targetWidth, targetHeight] })
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = targetWidth
      tempCanvas.height = targetHeight
      const ctx = tempCanvas.getContext('2d')
      if (ctx) {
        await drawBackgroundToCanvas(ctx, targetWidth, targetHeight)
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
        pdf.addImage(tempCanvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, targetWidth, targetHeight)
      }
      return pdf.output('blob')
    }

    if (exportFormat === 'image/x-icon') {
      const icoCanvas = document.createElement('canvas')
      icoCanvas.width = 32
      icoCanvas.height = 32
      const icoCtx = icoCanvas.getContext('2d')
      if (!icoCtx) return null

      await drawBackgroundToCanvas(icoCtx, 32, 32)
      icoCtx.drawImage(img, 0, 0, 32, 32)

      const pngBlob = await new Promise<Blob | null>(resolve => icoCanvas.toBlob(resolve, 'image/png'))
      if (!pngBlob) return null

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

      return new Blob([icoBuffer], { type: 'image/x-icon' })
    }

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    await drawBackgroundToCanvas(ctx, targetWidth, targetHeight)
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

    let mimeType = exportFormat
    let quality = compressionQuality / 100
    if (exportFormat === 'image/png') quality = 1.0

    return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mimeType, quality))
  }

  useEffect(() => {
    let isMounted = true;
    const calculate = async () => {
      setIsCalculatingSize(true);
      try {
        const blob = await generateOutputBlob();
        if (isMounted && blob) {
          setEstimatedSize(blob.size);
        }
      } catch (e) {
        console.error(e)
      } finally {
        if (isMounted) setIsCalculatingSize(false);
      }
    };

    const timer = setTimeout(calculate, 600);
    return () => { isMounted = false; clearTimeout(timer); }
  }, [currentImage, exportFormat, compressionQuality, bgType, bgColor, bgGradientColor1, bgGradientColor2, bgGradientDir, bgImage, bgImageScale])

  const handleExport = async () => {
    const blob = await generateOutputBlob()
    if (!blob) {
      alert("Failed to generate output.")
      return
    }

    const finalUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = finalUrl
    
    let ext = exportFormat.split('/')[1]
    if (exportFormat === 'application/pdf') ext = 'pdf'
    if (exportFormat === 'image/x-icon') ext = 'ico'
    
    link.download = `${baseName}_zs_converter.${ext}`
    link.click()
  }

  const isLosslessFormat = exportFormat === 'image/png' || exportFormat === 'application/pdf' || exportFormat === 'image/x-icon'
  const sourceFormatDisplay = file.type.split('/')[1]?.toUpperCase() || 'UNKNOWN'

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
      <div className="flex-1 bg-slate-100 p-4 flex items-center justify-center relative group min-h-[400px] lg:min-h-full order-1 lg:order-2 overflow-hidden border-b lg:border-b-0">
        <button onClick={onCancel} className="absolute top-3 right-3 z-50 bg-white/90 text-slate-800 p-2 rounded-full shadow-md hover:bg-red-500 hover:text-white transition-colors" title="Close Image">
          <X className="w-5 h-5" />
        </button>

        <div className="absolute inset-0 z-0 overflow-hidden flex items-center justify-center" 
          style={{ 
            backgroundColor: bgType === 'color' ? bgColor : 'transparent',
            backgroundImage: bgType === 'gradient' ? `linear-gradient(${bgGradientDir}, ${bgGradientColor1}, ${bgGradientColor2})` : 'none'
          }}>
          {bgType === 'image' && bgImage && (
            <img src={bgImage} alt="Background" className="w-full h-full object-cover origin-center" style={{ transform: `scale(${bgImageScale / 100})` }} />
          )}
        </div>
        
        <div className="relative z-10 w-full h-full flex items-center justify-center p-2 overflow-hidden">
          {activeTool === 'crop' ? (
            <div className="w-full h-full flex items-center justify-center overflow-hidden">
              <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} aspect={cropAspect} className="max-w-full max-h-full">
                <img ref={imgRef} src={currentImage} alt="Crop Preview" className="w-auto h-auto max-w-full max-h-full" style={{ maxHeight: '55vh', ...previewStyle }} />
              </ReactCrop>
            </div>
          ) : (
            <img src={currentImage} alt="Workspace" className="max-w-full max-h-full object-contain drop-shadow-md transition-all" style={previewStyle} />
          )}
        </div>
      </div>

      {/* Toolbar Sidebar */}
      <div className="w-full lg:w-[340px] h-auto lg:h-full flex flex-col bg-slate-50 border-r-0 lg:border-r border-slate-200 order-2 lg:order-1 relative">
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 pb-4 flex flex-col gap-4 relative">
          <div className="flex justify-between items-center border-b border-slate-200 pb-2 flex-shrink-0">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2"><Settings2 className="w-4 h-4" /> Tools</h4>
            <button onClick={handleUndo} disabled={!canUndo} className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100 hover:text-[#6384A3] disabled:opacity-40 transition-colors shadow-sm">
              <Undo2 className="w-3 h-3" /> Undo Action
            </button>
          </div>
          
          {/* Background Tool */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm transition-all relative ${activeTool === 'bg' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => setActiveTool(activeTool === 'bg' ? null : 'bg')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'bg' ? 'rounded-t-lg' : 'rounded-lg'}`}>
              <Eraser className="w-4 h-4 text-[#6384A3]" /> Background Removal
            </button>
            {activeTool === 'bg' && (
              <div className="p-4 bg-white space-y-4 border-t border-slate-100 rounded-b-lg">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">1. AI Model</label>
                  <CustomDropdown 
                    value={selectedModel} 
                    onChange={setSelectedModel} 
                    direction="down"
                    options={[
                      { value: 'briaai/RMBG-1.4', label: 'Pro AI (Best for Objects & Products)' },
                      { value: 'isnet_fp16', label: 'Standard AI (Best for People & Faces)' },
                      { value: 'isnet', label: 'Maximum Detail AI (Best for Hair & Edges)' }
                    ]}
                  />
                  <button onClick={handleRemoveBg} disabled={isRemovingBg} className="w-full py-2.5 mt-2 bg-[#6384A3] text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#4f6a83] disabled:opacity-50 flex justify-center items-center gap-2">
                    {isRemovingBg ? 'Processing...' : <><Wand2 className="w-3 h-3"/> Remove Background</>}
                  </button>
                </div>
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">2. Add New Background</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setBgType('transparent'); setBgImage(null); }} className={`py-1.5 text-[10px] font-bold uppercase tracking-wider rounded border ${bgType === 'transparent' ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>None</button>
                    <button onClick={() => setBgType('color')} className={`py-1.5 text-[10px] font-bold uppercase tracking-wider rounded border flex items-center justify-center gap-1 ${bgType === 'color' ? 'bg-[#6384A3] text-white border-[#6384A3]' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}><Palette className="w-3 h-3"/> Color</button>
                    <button onClick={() => setBgType('gradient')} className={`py-1.5 text-[10px] font-bold uppercase tracking-wider rounded border flex items-center justify-center gap-1 ${bgType === 'gradient' ? 'bg-[#6384A3] text-white border-[#6384A3]' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}><Blend className="w-3 h-3"/> Gradient</button>
                    <button onClick={() => document.getElementById('bg-upload')?.click()} className={`py-1.5 text-[10px] font-bold uppercase tracking-wider rounded border flex items-center justify-center gap-1 ${bgType === 'image' ? 'bg-[#6384A3] text-white border-[#6384A3]' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}><ImageIcon className="w-3 h-3"/> Image</button>
                    <input type="file" id="bg-upload" accept="image/*" className="hidden" onChange={handleBgImageUpload} />
                  </div>

                  {bgType === 'color' && (
                    <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded mt-2">
                      <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-10 h-8 rounded cursor-pointer p-0 border-0 bg-transparent" />
                      <span className="font-mono text-xs font-bold text-slate-700 uppercase tracking-wider">{bgColor}</span>
                    </div>
                  )}

                  {bgType === 'gradient' && (
                    <div className="space-y-3 p-2 bg-slate-50 border border-slate-200 rounded mt-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input type="color" value={bgGradientColor1} onChange={(e) => setBgGradientColor1(e.target.value)} className="w-8 h-8 rounded cursor-pointer p-0 border-0 bg-transparent" />
                          <span className="font-mono text-[10px] font-bold text-slate-700 uppercase tracking-wider">{bgGradientColor1}</span>
                        </div>
                        <span className="text-slate-400 text-xs font-bold">to</span>
                        <div className="flex items-center gap-2">
                          <input type="color" value={bgGradientColor2} onChange={(e) => setBgGradientColor2(e.target.value)} className="w-8 h-8 rounded cursor-pointer p-0 border-0 bg-transparent" />
                          <span className="font-mono text-[10px] font-bold text-slate-700 uppercase tracking-wider">{bgGradientColor2}</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Direction</label>
                        <CustomDropdown 
                          value={bgGradientDir} 
                          onChange={setBgGradientDir} 
                          direction="up"
                          options={[
                            { value: 'to bottom', label: 'Top to Bottom (⬇️)' },
                            { value: 'to right', label: 'Left to Right (➡️)' },
                            { value: 'to bottom right', label: 'Top-Left to Bottom-Right (↘️)' },
                            { value: 'to top right', label: 'Bottom-Left to Top-Right (↗️)' }
                          ]} 
                        />
                      </div>
                    </div>
                  )}

                  {bgType === 'image' && bgImage && (
                    <div className="space-y-2 bg-slate-50 border border-slate-200 rounded p-3 mt-2">
                      <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        <span>Zoom BG</span>
                        <span className="text-[#6384A3]">{bgImageScale}%</span>
                      </div>
                      <input type="range" min="10" max="300" value={bgImageScale} onChange={(e) => setBgImageScale(Number(e.target.value))} className="w-full accent-[#6384A3]" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Transform & Shape Tool */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm transition-all relative ${activeTool === 'transform' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => setActiveTool(activeTool === 'transform' ? null : 'transform')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'transform' ? 'rounded-t-lg' : 'rounded-lg'}`}>
              <RotateCw className="w-4 h-4 text-[#6384A3]" /> Transform & Shape
            </button>
            {activeTool === 'transform' && (
              <div className="p-4 bg-white border-t border-slate-100 space-y-4 rounded-b-lg">
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
                <div className="flex gap-2 pt-2 border-t border-slate-100 mt-2">
                  <button onClick={() => setLiveTransform({ rotate: 0, flipH: false, flipV: false, radius: 0 })} className="flex-[0.5] py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50 flex justify-center items-center" title="Reset">
                    <RefreshCcw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setActiveTool('export'); setLiveTransform({ rotate: 0, flipH: false, flipV: false, radius: 0 }); }} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                  <button onClick={handleApplyTransform} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply</button>
                </div>
              </div>
            )}
          </div>
          
          {/* Frame & Crop Tool */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm transition-all relative ${activeTool === 'crop' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => setActiveTool(activeTool === 'crop' ? null : 'crop')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'crop' ? 'rounded-t-lg' : 'rounded-lg'}`}>
              <CropIcon className="w-4 h-4 text-[#6384A3]" /> Frame & Crop
            </button>
            {activeTool === 'crop' && (
              <div className="p-4 bg-white border-t border-slate-100 space-y-4 rounded-b-lg">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Crop Aspect Ratio</label>
                  <CustomDropdown 
                    value={cropAspect ? cropAspect.toString() : 'free'}
                    onChange={(val) => setCropAspect(val === 'free' ? undefined : Number(val))}
                    direction="down"
                    options={[
                      { value: 'free', label: 'Freehand (No Aspect)' },
                      { value: '1', label: 'Square (1:1)' },
                      { value: (4/5).toString(), label: 'BD Passport / Stamp (4:5)' },
                      { value: (16/9).toString(), label: 'Widescreen (16:9)' }
                    ]}
                  />
                </div>
                <div className="p-3 bg-blue-50 border border-blue-100 rounded text-xs text-blue-800 flex flex-col gap-1.5">
                  <span className="font-bold flex items-center gap-1.5"><Maximize className="w-3.5 h-3.5"/> Framing Tip</span>
                  <span className="opacity-90">Drag the edges of the box on the image to frame and "zoom" into your subject perfectly.</span>
                </div>
                <div className="flex gap-2 pt-2 border-t border-slate-100 mt-2">
                  <button onClick={() => setActiveTool('export')} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                  <button onClick={handleApplyCrop} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply Crop</button>
                </div>
              </div>
            )}
          </div>

          {/* Enhance Tool */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm transition-all relative ${activeTool === 'enhance' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => setActiveTool(activeTool === 'enhance' ? null : 'enhance')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'enhance' ? 'rounded-t-lg' : 'rounded-lg'}`}>
              <Sparkles className="w-4 h-4 text-[#6384A3]" /> Enhance Photo
            </button>
            {activeTool === 'enhance' && (
              <div className="p-4 bg-white border-t border-slate-100 space-y-4 rounded-b-lg">
                <div className="flex justify-end">
                  <button onClick={handleAutoEnhance} className="py-1.5 px-3 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 hover:bg-indigo-100 transition-colors shadow-sm">
                    <Wand2 className="w-3 h-3" /> Auto Fix
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
                <div className="flex gap-2 pt-2 border-t border-slate-100 mt-2">
                  <button onClick={() => setLiveFilters(defaultFilters)} className="flex-[0.5] py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50 flex justify-center items-center" title="Reset">
                    <RefreshCcw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setActiveTool('export'); setLiveFilters(defaultFilters); }} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                  <button onClick={handleApplyEnhancements} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply</button>
                </div>
              </div>
            )}
          </div>

          {/* Resize Output Dimensions Accordion */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm transition-all relative ${activeTool === 'resize' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => setActiveTool(activeTool === 'resize' ? null : 'resize')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'resize' ? 'rounded-t-lg' : 'rounded-lg'}`}>
              <Maximize className="w-4 h-4 text-[#6384A3]" /> Resize Dimensions
            </button>
            {activeTool === 'resize' && (
              <div className="p-4 bg-white border-t border-slate-100 space-y-4 rounded-b-lg">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Output Dimensions</label>
                  <CustomDropdown 
                    value={presetSize} 
                    onChange={handlePresetChange} 
                    direction="up"
                    options={[
                      { value: 'custom', label: 'Original / Custom Size' },
                      { value: '472x591', label: 'BD Passport (472x591 px)' },
                      { value: '236x295', label: 'BD Stamp Size (236x295 px)' },
                      { value: '1920x1080', label: 'Full HD (1920x1080 px)' },
                      { value: '1080x1080', label: 'Instagram Square (1080x1080 px)' },
                    ]}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Width (px)</label>
                      <input 
                        type="number" 
                        placeholder="Auto" 
                        value={resizeWidth} 
                        onChange={(e) => { setResizeWidth(e.target.value ? Number(e.target.value) : ''); setPresetSize('custom'); }} 
                        className="w-full p-2 border border-slate-200 rounded text-sm bg-white" 
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Height (px)</label>
                      <input 
                        type="number" 
                        placeholder="Auto" 
                        value={resizeHeight} 
                        onChange={(e) => { setResizeHeight(e.target.value ? Number(e.target.value) : ''); setPresetSize('custom'); }} 
                        className="w-full p-2 border border-slate-200 rounded text-sm bg-white" 
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mt-2 text-[10px] font-bold text-slate-600 cursor-pointer uppercase tracking-widest">
                    <input 
                      type="checkbox" 
                      checked={maintainRatio} 
                      onChange={(e) => setMaintainRatio(e.target.checked)} 
                      className="w-3.5 h-3.5 accent-[#6384A3] rounded cursor-pointer" 
                    />
                    Maintain Ratio (Fit Inside)
                  </label>
                </div>
                <div className="flex gap-2 pt-2 border-t border-slate-100 mt-2">
                  <button onClick={() => { setResizeWidth(''); setResizeHeight(''); setPresetSize('custom'); }} className="flex-[0.5] py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50 flex justify-center items-center" title="Reset">
                    <RefreshCcw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setActiveTool('export'); setResizeWidth(''); setResizeHeight(''); }} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                  <button onClick={handleApplyResize} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply Resize</button>
                </div>
              </div>
            )}
          </div>

          {/* Export Settings Accordion */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm mb-4 transition-all relative ${activeTool === 'export' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => setActiveTool(activeTool === 'export' ? null : 'export')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'export' ? 'rounded-t-lg' : 'rounded-lg'}`}>
              <Type className="w-4 h-4 text-[#6384A3]" /> Format & Export
            </button>
            {activeTool === 'export' && (
              <div className="p-4 bg-white border-t border-slate-100 space-y-4 rounded-b-lg">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200 pb-2">
                  <span>Current Dimensions</span>
                  <span className="text-[#6384A3]">{imgDims.w} x {imgDims.h} px</span>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-bold text-[10px] uppercase tracking-widest">Source Format: <span className="text-[#6384A3]">{sourceFormatDisplay}</span></span>
                  </div>
                  <CustomDropdown 
                    value={exportFormat} 
                    onChange={setExportFormat} 
                    direction="up"
                    options={[
                      { value: 'image/png', label: 'PNG (Lossless, Largest)' },
                      { value: 'image/webp', label: 'WebP (Optimized, Transparent)' },
                      { value: 'image/jpeg', label: 'JPG / JPEG (No Transparency)' },
                      { value: 'image/x-icon', label: 'ICO Favicon (32x32)' },
                      { value: 'application/pdf', label: 'PDF Document' }
                    ]}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                    <span className="text-slate-500">Output Quality</span>
                    <span className="text-[#6384A3]">{compressionQuality}%</span>
                  </div>
                  <input type="range" value={compressionQuality} min={10} max={100} onChange={(e) => setCompressionQuality(Number(e.target.value))} className="w-full accent-[#6384A3]" />
                </div>

                <div className="bg-slate-100 rounded border border-slate-200 p-3 space-y-1.5 shadow-inner">
                  <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <span>Original File Size</span>
                    <span>{formatBytes(file.size)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                    <span className="text-slate-700">Output Estimate</span>
                    {isCalculatingSize ? (
                      <span className="text-slate-400 animate-pulse">Calculating...</span>
                    ) : (
                      <span className={estimatedSize && estimatedSize < file.size ? 'text-green-600' : 'text-orange-600'}>
                        {estimatedSize ? formatBytes(estimatedSize) : 'Unknown'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Global Save Action */}
        <div className="p-4 lg:p-6 border-t border-slate-200 bg-slate-50 flex-shrink-0 z-10">
          <button onClick={handleExport} className="w-full py-3 px-4 bg-slate-900 text-white rounded-lg hover:bg-black text-center transition-colors font-bold text-xs uppercase tracking-widest shadow-md flex items-center justify-center gap-2">
            <Download className="w-4 h-4" /> Convert & Save
          </button>
        </div>
      </div>
    </div>
  )
}