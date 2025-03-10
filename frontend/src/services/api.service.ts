import axios from 'axios'
import { S3_URL, S3_PATHS, DEFAULT_PAGINATION } from '../config/api.config'
import {
  Movie,
  Genre,
  PaginationParams,
  MovieSearchRequest,
  MovieInterestingRequest,
} from '../types/api.types'

const s3Api = axios.create({
  baseURL: S3_URL,
})

// Функция для преобразования URL постера
const getPosterUrl = (posterPath: string | null): string | null => {
  if (!posterPath) return null
  return `${S3_URL}${S3_PATHS.POSTERS}${posterPath}`
}

// Функция для локализации фильма
const localizeMovie = (movie: Movie): Movie => ({
  ...movie,
  title: movie.title_ru || movie.title,
  description: movie.description_ru || movie.description,
  poster_url: getPosterUrl(movie.poster_url),
})

export const MovieService = {
  // Получение списка фильмов с пагинацией
  async getMovies(
    params: PaginationParams = DEFAULT_PAGINATION
  ): Promise<Movie[]> {
    try {
      const response = await s3Api.get<Movie[]>(`${S3_PATHS.MOVIES}/all.json`)
      const allMovies = response.data

      // Применяем пагинацию
      const start = (params.page - 1) * params.size
      const end = start + params.size
      const paginatedMovies = allMovies.slice(start, end)

      // Локализуем фильмы
      return paginatedMovies.map(localizeMovie)
    } catch (error) {
      console.error('Error fetching movies:', error)
      return []
    }
  },

  // Получение топ фильмов
  async getTopRated(): Promise<Movie[]> {
    try {
      const response = await s3Api.get<Movie[]>(S3_PATHS.TOP_RATED)
      return response.data.map(localizeMovie)
    } catch (error) {
      console.error('Error fetching top rated movies:', error)
      return []
    }
  },

  // Поиск фильмов
  async searchMovies(query: MovieSearchRequest): Promise<Movie[]> {
    try {
      const response = await s3Api.get<Movie[]>(`${S3_PATHS.MOVIES}/all.json`)
      const allMovies = response.data

      const searchResults = allMovies.filter((movie) => {
        const searchTerm = query.movie.toLowerCase()
        return (
          movie.title_ru?.toLowerCase().includes(searchTerm) ||
          movie.title.toLowerCase().includes(searchTerm)
        )
      })

      return searchResults.map(localizeMovie)
    } catch (error) {
      console.error('Error searching movies:', error)
      return []
    }
  },

  // Получение похожих фильмов
  async getInteresting(params: MovieInterestingRequest): Promise<Movie[]> {
    try {
      const response = await s3Api.get<Movie[]>(
        `${S3_PATHS.MOVIES}/recommendations/${params.movie_id}.json`
      )
      return response.data.map(localizeMovie)
    } catch (error) {
      console.error('Error fetching interesting movies:', error)
      return []
    }
  },

  // Получение жанров
  async getGenres(): Promise<Genre[]> {
    try {
      const response = await s3Api.get<Genre[]>(S3_PATHS.GENRES)
      return response.data.map((genre) => ({
        ...genre,
        name: genre.name_ru || genre.name,
      }))
    } catch (error) {
      console.error('Error fetching genres:', error)
      return []
    }
  },
}
