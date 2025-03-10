export const API_URL =
  'https://mai-study-projects-online-cinema-online-cinema-backen-b422.twc1.net/api/v1'

export const S3_URL =
  'https://mai-study-projects-online-cinema.s3.eu-north-1.amazonaws.com'

export const S3_PROXY_URL = 'http://localhost:3001/s3'

export const S3_PATHS = {
  MOVIES: '/movies',
  POSTERS: '/posters',
  TOP_RATED: '/top_rated.json',
  GENRES: '/genres.json',
} as const

export const API_ENDPOINTS = {
  // Movies
  MOVIES: '/movies',
  MOVIES_TOP_RATED: '/movies/top_rated',
  MOVIES_SEARCH: '/movies/search',
  MOVIES_INTERESTING: '/movies/may_be_interesting',

  // Users
  LOGIN: '/users/login',
} as const

export const DEFAULT_PAGINATION = {
  page: 1,
  size: 50,
} as const
