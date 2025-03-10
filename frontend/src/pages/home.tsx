import { useEffect, useState } from 'react'

import { MovieService } from '../api/movie-api'
import { Container } from '../components/container'
import { HeroSlider } from '../components/hero-slider'
import { CustomSlider } from '../components/slider'
import { Film } from '../interfaces'

export const HomePage = () => {
  const [topMovies, setTopMovies] = useState<Film[]>([])
  const [recommendedMovies, setRecommendedMovies] = useState<Film[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const [top, recommended] = await Promise.all([
          MovieService.getTopRated(),
          MovieService.getRecommendations(10),
        ])
        setTopMovies(top)
        setRecommendedMovies(recommended)
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-xl text-gray-400">Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-12">
      {/* Hero слайдер */}
      <HeroSlider movies={topMovies} />

      {/* Основной контент */}
      <Container>
        {/* Топ фильмов */}
        <section className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Топ фильмов</h2>
          <CustomSlider movies={topMovies} />
        </section>

        {/* Рекомендации */}
        {recommendedMovies.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-6 text-2xl font-bold">Рекомендуемые фильмы</h2>
            <CustomSlider movies={recommendedMovies} />
          </section>
        )}
      </Container>
    </div>
  )
}
