'use client'

import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { prefersReducedMotion } from '../lib/spring'

/**
 * Картинка, которая может быть анимированной (WebP-стикер из GIF или видео). Анимированный
 * WebP браузер играет сам в обычном `<img>`; при «уменьшении движения» (prefers-reduced-
 * motion) показываем неподвижный первый кадр — как кружки и превью видео, которые в этом
 * режиме не играют сами (DESIGN_SYSTEM: декоративное движение выключается).
 *
 * Остановить `<img>` нельзя, поэтому первый кадр рисуется в canvas того же размера. Пиксели
 * canvas не читаются, так что подписанная ссылка без CORS ему не мешает.
 */
export function AnimatedImage({
  animated,
  src,
  alt,
  className,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & { animated: boolean; src: string; alt: string }) {
  const [still, setStill] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!animated || !prefersReducedMotion()) return
    setStill(true)
  }, [animated])

  useEffect(() => {
    if (!still) return
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')?.drawImage(img, 0, 0)
    }
    img.src = src
    return () => {
      img.onload = null
    }
  }, [still, src])

  if (still) {
    return (
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={className}
        style={{
          width: rest.width ? Number(rest.width) : undefined,
          height: rest.height ? Number(rest.height) : undefined,
        }}
      />
    )
  }
  return <img src={src} alt={alt} className={className} {...rest} />
}
