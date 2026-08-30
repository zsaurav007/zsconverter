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

type ToolType = 'crop' | 'bg' | 'enhance' | 'transform' | 'resize' | 'export' | null

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
  
  const [activeTool, setActiveTool] = useState<ToolType>('export')
  const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name

  const [imgDims, setImgDims] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const img = new Image()
    img.onload = () => setImgDims({ w: img.width, h: img.height })
    img.src = currentImage
  }, [currentImage])

  const previewContainerRef = useRef<HTMLDivElement>(null)
  const [baseRenderDims, setBaseRenderDims] = useState({ w: 0, h: 0 })

  // Dynamically calculate the perfect 1:1 screen fit size on load
  useEffect(() => {
    if (imgDims.w === 0 || activeTool !== 'crop') return
    
    const updateDims = () => {
      if (!previewContainerRef.current) return
      const { clientWidth, clientHeight } = previewContainerRef.current
      const availW = clientWidth - 32 
      const availH = clientHeight - 32 
      
      const imgAspect = imgDims.w / imgDims.h
      const containerAspect = availW / availH
      
      if (imgAspect > containerAspect) {
        setBaseRenderDims({ w: availW, h: availW / imgAspect })
      } else {
        setBaseRenderDims({ w: availH * imgAspect, h: availH })
      }
    }

    updateDims()
    window.addEventListener('resize', updateDims)
    const timeoutId = setTimeout(updateDims, 50)
    
    return () => {
      window.removeEventListener('resize', updateDims)
      clearTimeout(timeoutId)
    }
  }, [imgDims, activeTool, currentImage])

  const [liveTransform, setLiveTransform] = useState({ rotate: 0, flipH: false, flipV: false, radius: 0 })

  const [cropAspect, setCropAspect] = useState<number | undefined>(undefined)
  const [cropPreset, setCropPreset] = useState<string>('free')
  const [imageZoom, setImageZoom] = useState<number>(1)
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 50, height: 50, x: 25, y: 25 })
  const [completedCrop, setCompletedCrop] = useState<Crop | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Auto-convert standard % crop into strict pixel crop once dims load so the frame stays rigid
  useEffect(() => {
    if (baseRenderDims.w > 0 && crop.unit === '%') {
      const initialW = baseRenderDims.w * 0.5;
      const initialH = baseRenderDims.h * 0.5;
      const calcCrop: Crop = {
        unit: 'px',
        width: initialW,
        height: initialH,
        x: (baseRenderDims.w - initialW) / 2,
        y: (baseRenderDims.h - initialH) / 2
      }
      setCrop(calcCrop)
      setCompletedCrop(calcCrop)
    }
  }, [baseRenderDims])

  // Smart tracking to keep crop box centered exactly in the scroll container when image resizes
  useEffect(() => {
    if (previewContainerRef.current && activeTool === 'crop' && crop.unit === 'px') {
      const container = previewContainerRef.current;
      const padding = 16;
      const scrollX = crop.x + padding + crop.width / 2 - container.clientWidth / 2;
      const scrollY = crop.y + padding + crop.height / 2 - container.clientHeight / 2;
      container.scrollTo({ left: Math.max(0, scrollX), top: Math.max(0, scrollY) });
    }
  }, [imageZoom]) 

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

  const validFormats = ['image/png', 'image/webp', 'image/jpeg', 'image/x-icon', 'application/pdf']
  const [exportFormat, setExportFormat] = useState<string>(validFormats.includes(file.type) ? file.type : 'image/png')
  const [compressionQuality, setCompressionQuality] = useState<number>(85)

  const [estimatedSize, setEstimatedSize] = useState<number | null>(null)
  const [isCalculatingSize, setIsCalculatingSize] = useState(false)

  const pushToGlobalHistory = (newImageUrl: string) => setHistory(prev => [...prev, newImageUrl])
  const handleUndo = () => { if (canUndo) setHistory(prev => prev.slice(0, -1)) }

  const handleApplyEnhancements = async (switchTool: boolean = true) => {
    const img = await createImage(currentImage)
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.filter = `brightness(${liveFilters.b}%) contrast(${liveFilters.c}%) saturate(${liveFilters.s}%) sepia(${liveFilters.sep}%)`
    ctx.drawImage(img, 0, 0)
    
    pushToGlobalHistory(canvas.toDataURL('image/png'))
    setLiveFilters(defaultFilters)
    if (switchTool) setActiveTool('export')
  }

  const handleApplyTransform = async (switchTool: boolean = true) => {
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
    setLiveTransform({ rotate: 0, flipH: false, flipV: false, radius: 0 })
    if (switchTool) setActiveTool('export')
  }

  const changeTool = async (newTool: ToolType) => {
    if (activeTool === 'enhance' && (liveFilters.b !== 100 || liveFilters.c !== 100 || liveFilters.s !== 100 || liveFilters.sep !== 0)) {
      await handleApplyEnhancements(false)
    }
    if (activeTool === 'transform' && (liveTransform.rotate !== 0 || liveTransform.flipH || liveTransform.flipV || liveTransform.radius !== 0)) {
      await handleApplyTransform(false)
    }
    if (activeTool === 'crop' && newTool !== 'crop') {
      setImageZoom(1)
      setCropAspect(undefined)
      setCropPreset('free')
      setCrop({ unit: '%', width: 50, height: 50, x: 25, y: 25 })
    }
    setActiveTool(newTool)
  }

  const handleRemoveBg = async () => {
    setIsRemovingBg(true)
    try {
      const optimizedDataUrl = await optimizeImageForAI(currentImage)
      let removedSuccessfully = false;

      if (selectedModel === 'briaai/RMBG-1.4') {
        try {
          const { AutoModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
          env.allowLocalModels = false; 
          const model = await AutoModel.from_pretrained(selectedModel, { config: { model_type: 'custom' } as any });
          const processor = await AutoProcessor.from_pretrained(selectedModel, {
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

          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = outTensor.dims[3];
          maskCanvas.height = outTensor.dims[2];
          const maskCtx = maskCanvas.getContext('2d');
          if (!maskCtx) throw new Error("Mask Context failed");

          const imgData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
          for (let i = 0; i < outTensor.data.length; i++) {
             const val = Math.max(0, Math.min(255, Math.round(outTensor.data[i] * 255)));
             imgData.data[i * 4] = 0; imgData.data[i * 4 + 1] = 0; imgData.data[i * 4 + 2] = 0; imgData.data[i * 4 + 3] = val;
          }
          maskCtx.putImageData(imgData, 0, 0);

          const originalImg = await createImage(currentImage);
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = originalImg.width;
          finalCanvas.height = originalImg.height;
          const finalCtx = finalCanvas.getContext('2d');
          if (!finalCtx) throw new Error("Final context failed");

          finalCtx.drawImage(originalImg, 0, 0);
          finalCtx.globalCompositeOperation = 'destination-in';
          finalCtx.drawImage(maskCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
          
          pushToGlobalHistory(finalCanvas.toDataURL('image/png'));
          removedSuccessfully = true;
        } catch (hfError) {
          console.warn("Manual RMBG-1.4 engine failed. Falling back to Imgly...", hfError);
        }
      }

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

  const handleImageZoomChange = (newZoom: number) => {
    const oldZoom = imageZoom
    const R = newZoom / oldZoom
    setImageZoom(newZoom)
    
    if (crop.width && crop.height) {
      let currentW = crop.width;
      let currentH = crop.height;
      let currentX = crop.x;
      let currentY = crop.y;

      if (crop.unit === '%') {
         const imgW = baseRenderDims.w * oldZoom;
         const imgH = baseRenderDims.h * oldZoom;
         currentW = (crop.width / 100) * imgW;
         currentH = (crop.height / 100) * imgH;
         currentX = (crop.x / 100) * imgW;
         currentY = (crop.y / 100) * imgH;
      }

      const cx = currentX + currentW / 2
      const cy = currentY + currentH / 2
      
      const newCx = cx * R
      const newCy = cy * R
      
      let nx = newCx - currentW / 2
      let ny = newCy - currentH / 2
      
      const newImgW = baseRenderDims.w * newZoom
      const newImgH = baseRenderDims.h * newZoom
      
      nx = Math.max(0, Math.min(nx, newImgW - currentW))
      ny = Math.max(0, Math.min(ny, newImgH - currentH))

      const newCrop = {
        unit: 'px' as const,
        width: currentW,
        height: currentH,
        x: nx,
        y: ny
      }
      setCrop(newCrop)
      setCompletedCrop(newCrop)
    }
  }

  const handleAspectChange = (val: string) => {
    setCropPreset(val)
    let newAspect: number | undefined = undefined
    
    if (val === 'square') newAspect = 1
    else if (val === 'passport') newAspect = 472 / 591
    else if (val === 'stamp') newAspect = 236 / 295
    else if (val === '16:9') newAspect = 16 / 9

    setCropAspect(newAspect)

    const currentImgW = baseRenderDims.w * imageZoom
    const currentImgH = baseRenderDims.h * imageZoom

    // The crop frame calculates strictly off screen size so it never blows up when you zoom
    let targetFrameW = baseRenderDims.w * 0.7
    let targetFrameH = baseRenderDims.h * 0.7

    if (newAspect) {
      const frameAspect = targetFrameW / targetFrameH
      if (frameAspect > newAspect) {
        targetFrameW = targetFrameH * newAspect
      } else {
        targetFrameH = targetFrameW / newAspect
      }
    }

    const calculatedCrop: Crop = {
      unit: 'px',
      width: targetFrameW,
      height: targetFrameH,
      x: (currentImgW - targetFrameW) / 2,
      y: (currentImgH - targetFrameH) / 2
    }
    
    setCrop(calculatedCrop)
    setCompletedCrop(calculatedCrop)
  }

  const handleApplyCrop = async () => {
    if (!imgRef.current || !completedCrop || completedCrop.width === 0 || completedCrop.height === 0) return
    const image = imgRef.current
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scaleX = image.naturalWidth / image.width
    const scaleY = image.naturalHeight / image.height

    let sourceCropX = completedCrop.x * scaleX
    let sourceCropY = completedCrop.y * scaleY
    let sourceCropW = completedCrop.width * scaleX
    let sourceCropH = completedCrop.height * scaleY

    if (completedCrop.unit === '%') {
      sourceCropX = (completedCrop.x / 100) * image.naturalWidth
      sourceCropY = (completedCrop.y / 100) * image.naturalHeight
      sourceCropW = (completedCrop.width / 100) * image.naturalWidth
      sourceCropH = (completedCrop.height / 100) * image.naturalHeight
    }

    let targetW = sourceCropW
    let targetH = sourceCropH

    if (cropPreset === 'passport') { 
      targetW = 472
      targetH = 591 
    } else if (cropPreset === 'stamp') { 
      targetW = 236
      targetH = 295 
    }

    canvas.width = targetW
    canvas.height = targetH

    ctx.drawImage(
      image,
      sourceCropX, 
      sourceCropY, 
      sourceCropW, 
      sourceCropH,
      0, 
      0, 
      targetW, 
      targetH
    )
    
    pushToGlobalHistory(canvas.toDataURL('image/png'))

    if (cropPreset === 'passport') {
      setPresetSize('472x591')
      setResizeWidth(472)
      setResizeHeight(591)
    } else if (cropPreset === 'stamp') {
      setPresetSize('236x295')
      setResizeWidth(236)
      setResizeHeight(295)
    }
    
    setCropAspect(undefined)
    setCropPreset('free')
    setImageZoom(1)
    setCrop({ unit: '%', width: 50, height: 50, x: 25, y: 25 })
    changeTool('export')
  }

  const handleAutoEnhance = () => {
    setLiveFilters({ b: 110, c: 105, s: 115, sep: 0 })
  }

  const handleApplyResize = async () => {
    const img = await createImage(currentImage)
    
    const rw = typeof resizeWidth === 'number' ? resizeWidth : null
    const rh = typeof resizeHeight === 'number' ? resizeHeight : null

    if (!rw && !rh) {
      changeTool('export')
      return
    }

    let finalCanvasWidth = rw || img.width
    let finalCanvasHeight = rh || img.height
    
    let drawWidth = finalCanvasWidth
    let drawHeight = finalCanvasHeight
    let drawX = 0
    let drawY = 0

    if (maintainRatio) {
      if (rw && rh) {
        finalCanvasWidth = rw
        finalCanvasHeight = rh
        const ratio = Math.min(rw / img.width, rh / img.height)
        drawWidth = Math.max(1, Math.round(img.width * ratio))
        drawHeight = Math.max(1, Math.round(img.height * ratio))
        drawX = Math.round((rw - drawWidth) / 2)
        drawY = Math.round((rh - drawHeight) / 2)
      } else if (rw) {
        finalCanvasWidth = rw
        finalCanvasHeight = Math.max(1, Math.round((img.height * rw) / img.width))
        drawWidth = finalCanvasWidth
        drawHeight = finalCanvasHeight
      } else if (rh) {
        finalCanvasHeight = rh
        finalCanvasWidth = Math.max(1, Math.round((img.width * rh) / img.height))
        drawWidth = finalCanvasWidth
        drawHeight = finalCanvasHeight
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = finalCanvasWidth
    canvas.height = finalCanvasHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight)
    pushToGlobalHistory(canvas.toDataURL('image/png'))
    setPresetSize('custom')
    setResizeWidth('')
    setResizeHeight('')
    changeTool('export')
  }

  const handlePresetChange = (val: string) => {
    setPresetSize(val)
    if (val !== 'custom') {
      const [w, h] = val.split('x').map(Number)
      setResizeWidth(w)
      setResizeHeight(h)
      setMaintainRatio(true) 
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
      let x0 = 0, y0 = 0, x1 = canvasW, y1 = canvasH
      if (bgGradientDir === 'to bottom') {
        x1 = 0
      } else if (bgGradientDir === 'to right') {
        y1 = 0
      } else if (bgGradientDir === 'to top right') {
        y0 = canvasH
        y1 = 0
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
      <div className="flex-1 bg-slate-100 flex relative group min-h-[400px] lg:min-h-full order-1 lg:order-2 overflow-hidden border-b lg:border-b-0">
        <button onClick={onCancel} className="absolute top-3 right-3 z-50 bg-white/90 text-slate-800 p-2 rounded-full shadow-md hover:bg-red-500 hover:text-white transition-colors" title="Close Image">
          <X className="w-5 h-5" />
        </button>

        <div className="absolute inset-0 z-0 overflow-hidden flex items-center justify-center pointer-events-none" 
          style={{ 
            backgroundColor: bgType === 'color' ? bgColor : 'transparent',
            backgroundImage: bgType === 'gradient' ? `linear-gradient(${bgGradientDir}, ${bgGradientColor1}, ${bgGradientColor2})` : 'none'
          }}>
          {bgType === 'image' && bgImage && (
            <img src={bgImage} alt="Background" className="w-full h-full object-cover origin-center" style={{ transform: `scale(${bgImageScale / 100})` }} />
          )}
        </div>
        
        {/* Scrollable workspace designed for deeply zoomed elements to not clip or restrict padding */}
        <div className="relative z-10 w-full h-full overflow-auto custom-scrollbar" ref={previewContainerRef}>
          {activeTool === 'crop' ? (
            <div style={{ display: 'flex', minWidth: '100%', minHeight: '100%', padding: '16px' }}>
              <div style={{ margin: 'auto' }}>
                <ReactCrop 
                  crop={crop} 
                  onChange={(_, percentCrop) => setCrop(percentCrop)} 
                  onComplete={(_, percentCrop) => setCompletedCrop(percentCrop)} 
                  aspect={cropAspect} 
                >
                  <img 
                    ref={imgRef} 
                    src={currentImage} 
                    alt="Crop Preview" 
                    style={{ 
                      width: baseRenderDims.w ? `${baseRenderDims.w * imageZoom}px` : 'auto', 
                      height: baseRenderDims.h ? `${baseRenderDims.h * imageZoom}px` : 'auto',
                      maxWidth: 'none',
                      maxHeight: 'none',
                      ...previewStyle 
                    }} 
                  />
                </ReactCrop>
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center p-4">
              <img 
                src={currentImage} 
                alt="Workspace" 
                style={{ 
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  ...previewStyle 
                }} 
              />
            </div>
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
            <button onClick={() => changeTool(activeTool === 'bg' ? null : 'bg')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'bg' ? 'rounded-t-lg' : 'rounded-lg'}`}>
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
            <button onClick={() => changeTool(activeTool === 'transform' ? null : 'transform')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'transform' ? 'rounded-t-lg' : 'rounded-lg'}`}>
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
                  <button onClick={() => { setLiveTransform({ rotate: 0, flipH: false, flipV: false, radius: 0 }); changeTool('export'); }} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                  <button onClick={() => handleApplyTransform(true)} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply</button>
                </div>
              </div>
            )}
          </div>
          
          {/* Frame & Crop Tool */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm transition-all relative ${activeTool === 'crop' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => changeTool(activeTool === 'crop' ? null : 'crop')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'crop' ? 'rounded-t-lg' : 'rounded-lg'}`}>
              <CropIcon className="w-4 h-4 text-[#6384A3]" /> Frame & Crop
            </button>
            {activeTool === 'crop' && (
              <div className="p-4 bg-white border-t border-slate-100 space-y-4 rounded-b-lg">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Crop Aspect Ratio</label>
                  <CustomDropdown 
                    value={cropPreset}
                    onChange={handleAspectChange}
                    direction="down"
                    options={[
                      { value: 'free', label: 'Freehand (No Aspect)' },
                      { value: 'square', label: 'Square (1:1)' },
                      { value: 'passport', label: 'BD Passport Size (40x50mm)' },
                      { value: 'stamp', label: 'BD Stamp Size (20x25mm)' },
                      { value: '16:9', label: 'Widescreen (16:9)' }
                    ]}
                  />
                </div>

                <div className="space-y-2 mt-4 border-t border-slate-100 pt-3">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <span>Image Zoom (Scale)</span>
                    <span className="text-[#6384A3]">{imageZoom.toFixed(2)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="5" 
                    step="0.05" 
                    value={imageZoom} 
                    onChange={(e) => handleImageZoomChange(Number(e.target.value))} 
                    className="w-full accent-[#6384A3]" 
                  />
                </div>

                <div className="p-3 bg-blue-50 border border-blue-100 rounded text-xs text-blue-800 flex flex-col gap-1.5 mt-2">
                  <span className="font-bold flex items-center gap-1.5"><Maximize className="w-3.5 h-3.5"/> Framing Tip</span>
                  <span className="opacity-90">Zoom the image using the slider below, then drag the frame to focus exactly on your subject.</span>
                </div>
                <div className="flex gap-2 pt-2 border-t border-slate-100 mt-2">
                  <button onClick={() => changeTool('export')} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                  <button onClick={() => handleApplyCrop()} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply Crop</button>
                </div>
              </div>
            )}
          </div>

          {/* Enhance Tool */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm transition-all relative ${activeTool === 'enhance' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => changeTool(activeTool === 'enhance' ? null : 'enhance')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'enhance' ? 'rounded-t-lg' : 'rounded-lg'}`}>
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
                  <button onClick={() => { setLiveFilters(defaultFilters); changeTool('export'); }} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                  <button onClick={() => handleApplyEnhancements(true)} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply</button>
                </div>
              </div>
            )}
          </div>

          {/* Resize Output Dimensions Accordion */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm transition-all relative ${activeTool === 'resize' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => changeTool(activeTool === 'resize' ? null : 'resize')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'resize' ? 'rounded-t-lg' : 'rounded-lg'}`}>
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
                    Maintain Ratio (Fit Inside Box)
                  </label>
                </div>
                <div className="flex gap-2 pt-2 border-t border-slate-100 mt-2">
                  <button onClick={() => { setResizeWidth(''); setResizeHeight(''); setPresetSize('custom'); }} className="flex-[0.5] py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50 flex justify-center items-center" title="Reset">
                    <RefreshCcw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setResizeWidth(''); setResizeHeight(''); changeTool('export'); }} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 border border-slate-200 rounded hover:bg-slate-50">Cancel</button>
                  <button onClick={handleApplyResize} className="flex-1 py-2 text-[10px] uppercase tracking-wider font-bold text-white bg-[#6384A3] rounded hover:bg-[#4f6a83]">Apply Resize</button>
                </div>
              </div>
            )}
          </div>

          {/* Export Settings Accordion */}
          <div className={`border border-slate-200 rounded-lg flex-shrink-0 bg-white shadow-sm mb-4 transition-all relative ${activeTool === 'export' ? 'z-20' : 'z-0'}`}>
            <button onClick={() => changeTool(activeTool === 'export' ? null : 'export')} className={`w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 text-left font-semibold text-sm flex items-center gap-3 transition-colors ${activeTool === 'export' ? 'rounded-t-lg' : 'rounded-lg'}`}>
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