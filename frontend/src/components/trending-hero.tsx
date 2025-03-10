import { Film } from '../interfaces'
import { Image } from './image'

interface Props {
  film: Film
  onPlayTrailer?: () => void
  onClick?: () => void
}

export const TrendingHero = (props: Props) => {
  return (
    <div
      className="group relative h-[300px] w-full cursor-pointer"
      onClick={props.onClick}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60" />
      <Image
        src={props.film.poster_url || '/placeholder-poster.jpg'}
        alt={props.film.title}
        className="h-full w-full object-cover"
      />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <h1 className="text-xl font-bold text-white">{props.film.title}</h1>
        <p className="mt-2 line-clamp-2 text-sm text-gray-300">
          {props.film.description}
        </p>
        {props.onPlayTrailer && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              props.onPlayTrailer?.()
            }}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/80"
          >
            Play Trailer
          </button>
        )}
      </div>
    </div>
  )
}
