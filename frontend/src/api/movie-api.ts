import axios from 'axios'
import { Film } from '../interfaces'

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000'
const POSTER_CACHE_PREFIX = 'movie_poster_'
const POSTER_CACHE_EXPIRY = 24 * 60 * 60 * 1000 // 24 часа

// Функции для работы с кешем постеров
const getPosterFromCache = (url: string): string | null => {
  try {
    const cacheKey = POSTER_CACHE_PREFIX + btoa(url)
    const cached = localStorage.getItem(cacheKey)
    if (!cached) return null

    const { data, timestamp } = JSON.parse(cached)
    if (Date.now() - timestamp > POSTER_CACHE_EXPIRY) {
      localStorage.removeItem(cacheKey)
      return null
    }

    return data
  } catch (error) {
    console.error('Error reading from poster cache:', error)
    return null
  }
}

const cachePoster = async (url: string): Promise<string> => {
  try {
    // Проверяем кеш
    const cached = getPosterFromCache(url)
    if (cached) return cached

    // Для S3 URL используем режим no-cors
    if (url.includes('s3.timeweb.cloud')) {
      return url // Возвращаем оригинальный URL для S3
    }

    // Для остальных URL пробуем кешировать
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const reader = new FileReader()

      return new Promise((resolve, reject) => {
        reader.onloadend = () => {
          try {
            const base64data = reader.result as string
            const cacheKey = POSTER_CACHE_PREFIX + btoa(url)
            localStorage.setItem(
              cacheKey,
              JSON.stringify({
                data: base64data,
                timestamp: Date.now(),
              }),
            )
            resolve(base64data)
          } catch (error) {
            console.error('Error caching poster:', error)
            resolve(url) // Возвращаем оригинальный URL в случае ошибки
          }
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } catch (error) {
      console.error('Error caching poster:', error)
      return url // Возвращаем оригинальный URL в случае ошибки
    }
  } catch (error) {
    console.error('Error in cachePoster:', error)
    return url // Возвращаем оригинальный URL в случае ошибки
  }
}

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Добавляем перехватчик запросов для JWT
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  },
)

// Добавляем перехватчик ответов
api.interceptors.response.use(
  (response) => {
    console.log(`✨ API Response [${response.config.url}]:`, {
      status: response.status,
      data: response.data,
      headers: response.headers,
    })
    return response
  },
  (error) => {
    console.error(`🔥 API Error [${error.config?.url}]:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    })

    // Если токен истек или недействителен, разлогиниваем пользователя
    if (error.response?.status === 401) {
      console.log('🔒 Токен истек или недействителен, выполняется выход...')
      localStorage.removeItem('token')
      window.location.href = '/login'
    }

    return Promise.reject(error)
  },
)

// Функция для прелоадинга изображений
const preloadImage = (url: string) => {
  if (url.includes('s3.timeweb.cloud')) {
    const img = new Image()
    img.src = url
  }
}

// Функция преобразования Movie в Film
const convertMovieToFilm = async (movie: any): Promise<Film | null> => {
  // Пропускаем фильмы без названия или с дефолтным названием
  if (!movie.title || movie.title === 'Без названия') {
    return null
  }

  // Кешируем постер, если он есть
  let posterUrl = movie.poster_url || ''
  if (posterUrl) {
    posterUrl = await cachePoster(posterUrl)
    // Прелоадим изображение
    preloadImage(posterUrl)
  }

  return {
    movie_id: movie.movie_id || movie.id,
    title: movie.title || '',
    description: movie.description || 'Описание отсутствует',
    release_date: movie.release_date || '',
    rating: movie.rating || 0,
    poster_url: posterUrl,
    video_url: movie.video_url || '',
    duration: movie.duration || 0,
    genres: movie.genres?.split('|') || [],
  }
}

// Обработка фильмов и кэширование постеров
async function processMovies(movies: any[]): Promise<Film[]> {
  if (!movies || !Array.isArray(movies)) {
    console.warn('Invalid movies data:', movies)
    return []
  }

  // Фильтруем null и undefined значения
  const validMovies = movies.filter((movie) => movie && movie.title)
  console.log('Valid movies:', validMovies)

  // Преобразуем каждый фильм
  const processedMovies = validMovies.map((movie) => ({
    movie_id: movie.movie_id || movie.id || 0,
    title: movie.title || 'Без названия',
    description: movie.description || 'Описание отсутствует',
    release_date: movie.release_date || '',
    rating: typeof movie.rating === 'number' ? movie.rating : 0,
    poster_url: movie.poster_url || '',
    video_url: movie.video_url || '',
    duration: typeof movie.duration === 'number' ? movie.duration : 0,
    genres: movie.genres?.split('|') || [],
  }))

  return processedMovies
}

// Функция для декодирования JWT токена
const decodeJWT = (token: string): any => {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )
    return JSON.parse(jsonPayload)
  } catch (error) {
    console.error('❌ Ошибка при декодировании JWT:', error)
    return null
  }
}

interface LoginResponse {
  access_token: string
  user_type: string
  username: string
  user_id: number
}

export const MovieService = {
  // Получение списка фильмов
  async getMovies(page: number = 1, size: number = 50) {
    try {
      const response = await api.get<any[]>('/api/v1/movies', {
        params: { page, size },
      })
      return await processMovies(response.data)
    } catch (error) {
      console.error('❌ Error fetching movies:', error)
      return []
    }
  },

  // Получение информации о конкретном фильме
  async getMovie(movieId: number): Promise<Film | null> {
    try {
      // Сначала проверяем, есть ли фейковый фильм
      const fakeMovie = localStorage.getItem(`fake_movie_${movieId}`)
      if (fakeMovie) {
        const parsedMovie = JSON.parse(fakeMovie)
        return parsedMovie as Film
      }

      // Если фейкового фильма нет, делаем запрос к API
      const response = await api.get<any>(`/api/v1/movies/${movieId}/show_page`)
      return await convertMovieToFilm(response.data)
    } catch (error) {
      console.error('❌ Error fetching movie:', error)
      return null
    }
  },

  // Получение рекомендаций
  async getRecommendations(count: number = 10) {
    try {
      const userId = localStorage.getItem('user_id')
      if (!userId) {
        console.warn(
          '⚠️ User ID не найден, возвращаем топ фильмов вместо рекомендаций',
        )
        return await this.getTopRated()
      }

      // Преобразуем ID в число для API
      const numericId = parseInt(userId)
      if (isNaN(numericId)) {
        console.warn(
          '⚠️ Некорректный формат ID пользователя, возвращаем топ фильмов',
        )
        return await this.getTopRated()
      }

      const response = await api.get<any[]>('/api/v1/movies/you_may_like', {
        params: { user_id: numericId, top_n: count },
      })
      return await processMovies(response.data)
    } catch (error) {
      console.error('❌ Ошибка при получении рекомендаций:', error)
      console.warn('⚠️ Возвращаем топ фильмов вместо рекомендаций')
      return await this.getTopRated()
    }
  },

  // Получение топ рейтинга
  async getTopRated() {
    try {
      // Запрашиваем больше фильмов, чтобы после фильтрации дубликатов осталось 12
      const response = await api.get<any[]>('/api/v1/movies/top_rated', {
        params: { limit: 20 }, // Запрашиваем 20, чтобы после фильтрации точно осталось 12
      })
      const movies = await processMovies(response.data)
      return movies.slice(0, 12) // Возвращаем только первые 12 фильмов
    } catch (error) {
      console.error('❌ Error fetching top rated movies:', error)
      return []
    }
  },

  // Поиск фильмов
  async searchMovies(query: string) {
    try {
      console.log('Searching for:', query)

      if (!query || typeof query !== 'string') {
        console.warn('Invalid search query:', query)
        return []
      }

      const trimmedQuery = query.trim().toLowerCase()
      if (!trimmedQuery) {
        return []
      }

      // Получаем все фильмы, которые могут подходить
      const response = await api.get<any[]>('/api/v1/movies/search', {
        params: {
          movie: trimmedQuery,
          limit: 100, // Увеличиваем лимит для лучшего поиска
        },
      })

      if (!response.data) {
        console.warn('Empty response data')
        return []
      }

      // Обрабатываем результаты
      const movies = await processMovies(response.data)

      // Разбиваем запрос на слова
      const queryWords = trimmedQuery
        .split(/\s+/)
        .filter((word) => word.length > 1)

      // Сортируем результаты по релевантности
      const sortedMovies = movies.sort((a, b) => {
        const aTitle = a.title.toLowerCase()
        const bTitle = b.title.toLowerCase()

        // Точное совпадение
        if (aTitle === trimmedQuery && bTitle !== trimmedQuery) return -1
        if (bTitle === trimmedQuery && aTitle !== trimmedQuery) return 1

        // Подсчитываем, сколько слов из запроса содержится в каждом названии
        const aMatchCount = queryWords.filter((word) =>
          aTitle.includes(word),
        ).length
        const bMatchCount = queryWords.filter((word) =>
          bTitle.includes(word),
        ).length

        // Сначала сортируем по количеству совпавших слов
        if (aMatchCount !== bMatchCount) {
          return bMatchCount - aMatchCount
        }

        // Если количество совпавших слов одинаково, проверяем порядок слов
        const aInOrder = queryWords.every((word, index) => {
          const prevWords = queryWords.slice(0, index)
          const prevIndex = prevWords.length
            ? Math.max(...prevWords.map((w) => aTitle.indexOf(w)))
            : -1
          return aTitle.indexOf(word) > prevIndex
        })

        const bInOrder = queryWords.every((word, index) => {
          const prevWords = queryWords.slice(0, index)
          const prevIndex = prevWords.length
            ? Math.max(...prevWords.map((w) => bTitle.indexOf(w)))
            : -1
          return bTitle.indexOf(word) > prevIndex
        })

        if (aInOrder && !bInOrder) return -1
        if (!aInOrder && bInOrder) return 1

        // По умолчанию сортируем по рейтингу
        return (b.rating || 0) - (a.rating || 0)
      })

      // Фильтруем результаты, оставляя только те, где есть все слова из запроса
      const filteredMovies = sortedMovies.filter((movie) => {
        const title = movie.title.toLowerCase()
        return queryWords.every((word) => title.includes(word))
      })

      console.log('Final processed and filtered movies:', filteredMovies)
      return filteredMovies
    } catch (error) {
      console.error('❌ Error searching movies:', error)
      return []
    }
  },

  // Получение похожих фильмов
  async getSimilarMovies(movieId: number) {
    try {
      const response = await api.get<any[]>(
        '/api/v1/movies/may_be_interesting',
        {
          params: { movie_id: movieId },
        },
      )
      return await processMovies(response.data)
    } catch (error) {
      console.error('❌ Error fetching similar movies:', error)
      return []
    }
  },

  // Получение URL для стриминга
  getStreamUrl(movieId: string): string {
    return `${API_URL}/api/v1/movies/${movieId}/stream`
  },

  // Прелоадинг топ фильмов
  async preloadTopMovies() {
    try {
      const response = await api.get<any[]>('/api/v1/movies/top_rated')
      // Запускаем прелоадинг в фоне
      processMovies(response.data).catch(console.error)
    } catch (error) {
      console.error('❌ Error preloading top movies:', error)
    }
  },

  // Аутентификация пользователя
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await api.post('/api/v1/users/login', {
      username,
      password,
    })
    return response.data
  },

  // Добавление нового фильма
  async addMovie(formData: FormData) {
    try {
      // Проверяем и форматируем данные
      const title = formData.get('title')?.toString().trim()
      const description = formData.get('description')?.toString().trim()
      const genres = formData.get('genres')?.toString().trim()
      const poster = formData.get('poster')

      if (!title || !description || !genres || !poster) {
        throw new Error('Не все обязательные поля заполнены')
      }

      // Создаем новый FormData для API
      const apiFormData = new FormData()

      // Добавляем базовые поля с дополнительной валидацией
      apiFormData.append('title', title)
      apiFormData.append('description', description)

      // Форматируем жанры: убираем лишние пробелы и проверяем формат
      const formattedGenres = genres
        .split('|')
        .map((g) => g.trim())
        .filter((g) => g)
        .join('|')

      if (!formattedGenres) {
        throw new Error('Некорректный формат жанров')
      }

      apiFormData.append('genres', formattedGenres)

      // Прверяем и добавляем постер
      if (poster instanceof File) {
        if (poster.size === 0) {
          throw new Error('Файл постера пуст')
        }
        apiFormData.append('poster', poster)
      } else {
        throw new Error('Некорректный формат файла постера')
      }

      console.log('📤 Отправляемые данные:', {
        title,
        description,
        genres: formattedGenres,
        poster:
          poster instanceof File
            ? {
                name: poster.name,
                type: poster.type,
                size: poster.size,
              }
            : 'invalid poster',
      })

      const response = await api.post('/api/v1/movies/add', apiFormData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Accept: 'application/json',
        },
        transformRequest: [(data) => data],
        timeout: 30000,
      })

      if (!response.data) {
        throw new Error('Сервер вернул пустой ответ')
      }

      console.log('✨ Фильм успешно добавлен:', response.data)
      return response.data
    } catch (error: any) {
      console.error('❌ Детали ошибки добавления фильма:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers,
        error: error,
      })

      if (error.response?.status === 500) {
        throw new Error(
          'Внутренняя ошибка сервера. Пожалуйста, попробуйте позже или обратитесь к администратору.',
        )
      }

      const errorDetail = error.response?.data?.detail || ''

      if (errorDetail.includes('violates not-null constraint')) {
        throw new Error(
          'Ошибка базы данных: Не удалось создать запись. Пожалуйста, обратитесь к администратору.',
        )
      }

      if (error.response?.status === 413) {
        throw new Error('Файл постера слишком большой')
      } else if (error.response?.status === 415) {
        throw new Error('Неподдерживаемый формат файла')
      } else if (error.response?.data?.detail) {
        throw new Error(error.response.data.detail)
      }

      throw new Error(
        'Ошибка при добавлении филь��а. Пожалуйста, попробуйте позже.',
      )
    }
  },

  // Поиск фильмов через Elasticsearch
  async elasticSearch(query: string, limit: number = 10) {
    try {
      const response = await api.get<any[]>('/api/v1/movies/elastic_search', {
        params: { query, limit },
      })
      return await processMovies(response.data)
    } catch (error) {
      console.error('❌ Error searching movies with Elasticsearch:', error)
      return []
    }
  },

  // Получение всех фильмов с пагинацией
  async getAllMovies(page: number = 1, size: number = 24) {
    try {
      const response = await api.get<any[]>('/api/v1/movies', {
        params: { page, size },
      })

      if (!response.data) {
        console.warn('Empty response data')
        return { movies: [], total: 0 }
      }

      const movies = await processMovies(response.data)

      // Получаем общее количество фильмов из заголовка
      const total = parseInt(response.headers['x-total-count'] || '0', 10)

      return {
        movies,
        total: total || movies.length,
      }
    } catch (error) {
      console.error('❌ Error fetching all movies:', error)
      return { movies: [], total: 0 }
    }
  },
}
