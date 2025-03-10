import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Film } from '../interfaces'

interface Props {
  movies: Film[]
}

export const HeroSlider = ({ movies }: Props) => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % movies.length)
    }, 5000)

    return () => clearInterval(interval)
  }, [movies.length])

  const handlePrevSlide = () => {
    setCurrentIndex((prev) => (prev - 1 + movies.length) % movies.length)
  }

  const handleNextSlide = () => {
    setCurrentIndex((prev) => (prev + 1) % movies.length)
  }

  if (!movies.length) return null

  const currentMovie = movies[currentIndex]

  return (
    <div className="relative h-[70vh] w-full overflow-hidden">
      {/* Фоновое изображение */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-700"
        style={{ backgroundImage: `url(${currentMovie.poster_url})` }}
      >
        {/* Градиентные оверлеи */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
      </div>

      {/* Контент */}
      <div className="relative flex h-full items-center">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl">
            <h1 className="mb-4 text-5xl font-bold text-white">
              {currentMovie.title}
            </h1>
            <p className="mb-8 text-lg text-gray-300">
              {currentMovie.description}
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => navigate(`/movie/${currentMovie.movie_id}`)}
                className="rounded-lg bg-primary px-8 py-3 font-medium text-white transition-colors hover:bg-primary/80"
              >
                Смотреть
              </button>
              <button
                onClick={() => navigate(`/movie/${currentMovie.movie_id}`)}
                className="rounded-lg bg-white/20 px-8 py-3 font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
              >
                Подробнее
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Кнопки навигации */}
      <button
        onClick={handlePrevSlide}
        className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>
      <button
        onClick={handleNextSlide}
        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      {/* Индикаторы */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
        {movies.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`h-2 rounded-full transition-all ${
              index === currentIndex
                ? 'w-8 bg-primary'
                : 'w-2 bg-white/50 hover:bg-white/80'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
