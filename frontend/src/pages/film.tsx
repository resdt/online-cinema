import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { MovieService } from '../api/movie-api'
import { Image } from '../components/image'
import { Loading } from '../components/loading'
import { Section } from '../components/section'
import { CustomSlider } from '../components/slider'
import { VideoPlayer } from '../components/video-player'
import { Film } from '../interfaces'

export const FilmPage = () => {
  const [film, setFilm] = useState<Film>()
  const [similarMovies, setSimilarMovies] = useState<Film[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [showPlayer, setShowPlayer] = useState(false)

  const navigate = useNavigate()
  const { id } = useParams()

  useEffect(() => {
    const fetchData = async () => {
      if (!id) {
        setError('ID фильма не указан')
        return
      }

      try {
        setIsLoading(true)
        setError('')
        const movieId = parseInt(id, 10)

        if (isNaN(movieId)) {
          setError('Некорректный ID фильма')
          return
        }

        // Получаем информацию о фильме и похожие фильмы параллельно
        const [movie, similar] = await Promise.all([
          MovieService.getMovie(movieId),
          MovieService.getSimilarMovies(movieId),
        ])

        if (movie) {
          setFilm(movie)
          setSimilarMovies(similar.filter((m) => m.movie_id !== movieId))
        } else {
          setError('Фильм не найден')
        }
      } catch (error) {
        console.error('Error fetching movie data:', error)
        setError('Ошибка при загрузке данных')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [id])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loading />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <div className="text-xl text-red-500">{error}</div>
        <button
          onClick={() => navigate('/')}
          className="rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary/80"
        >
          Вернуться на главную
        </button>
      </div>
    )
  }

  if (!film) {
    return null
  }

  return (
    <>
      {/* Hero Section */}
      <div className="relative h-[400px]">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60" />
        <Image
          src={film.poster_url || '/placeholder-poster.jpg'}
          alt={film.title}
          className="h-full w-full object-cover"
        />
      </div>

      {/* Movie Details */}
      <Section className="-mt-[150px] relative z-10">
        <div className="flex gap-8 mobile:flex-col">
          <Image
            src={film.poster_url || '/placeholder-poster.jpg'}
            alt={film.title}
            className="h-[300px] w-[200px] shrink-0 rounded-lg mobile:mx-auto"
          />

          <div className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold">{film.title}</h1>
            <p className="text-gray-300">{film.description}</p>
            <button
              onClick={() => setShowPlayer(!showPlayer)}
              className="w-fit rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary/80"
            >
              {showPlayer ? 'Скрыть плеер' : 'Смотреть фильм'}
            </button>
          </div>
        </div>

        {/* Video Player */}
        {showPlayer && (
          <div className="mt-8">
            <VideoPlayer
              src={MovieService.getStreamUrl(film.movie_id.toString())}
              poster={film.poster_url || '/placeholder-poster.jpg'}
              className="aspect-video w-full"
            />
          </div>
        )}
      </Section>

      {/* Similar Movies */}
      {similarMovies.length > 0 && (
        <Section title="Похожие фильмы">
          <CustomSlider movies={similarMovies} />
        </Section>
      )}
    </>
  )
}
