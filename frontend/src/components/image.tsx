import { useState } from 'react'

interface Props {
  src: string
  className?: string
  alt?: string
}

export const Image = ({ src, className = '', alt = '' }: Props) => {
  const [error, setError] = useState(false)

  if (!src || error) {
    return (
      <div
        className={`bg-primary/20 flex items-center justify-center ${className}`}
      >
        <span className="text-sm text-gray-400">Нет изображения</span>
      </div>
    )
  }

  return (
    <div className={`bg-primary/20 ${className}`}>
      <img
        src={src}
        className="h-full w-full object-cover"
        loading="lazy"
        alt={alt}
        onError={() => setError(true)}
      />
    </div>
  )
}
