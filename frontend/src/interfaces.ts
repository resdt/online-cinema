import { ReactNode } from 'react'

export interface CustomComponentProps {
  children?: ReactNode
  className?: string
}

export interface Film {
  movie_id: number
  title: string
  description: string
  release_date: string
  rating: number
  poster_url: string | null
  video_url: string
  duration: number
  genres: string[]
}

export interface SearchResponse {
  films: Film[]
  totalPages: number
}

export interface User {
  id: number
  name: string
  email: string
}

export interface MovieCardProps {
  movie: Film
  onClick?: () => void
}

export interface SliderProps {
  title: string
  movies: Film[]
  loading?: boolean
}
