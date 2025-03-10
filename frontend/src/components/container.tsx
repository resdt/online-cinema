import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export const Container = ({ children, className = '' }: Props) => {
  return (
    <div className={`mx-auto max-w-screen-lg px-6 py-3 ${className}`}>
      {children}
    </div>
  )
}
