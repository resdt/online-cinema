import { createContext, useContext, ReactNode, useState } from 'react'

interface User {
  id: number
  name: string
  email: string
  role: string
  login: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  login: (token: string, userData?: any) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
})

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const login = (token: string, userData?: any) => {
    // Декодируем JWT и получаем информацию о пользователе
    const decodedToken = decodeJWT(token)
    if (decodedToken || userData) {
      setUser({
        id: userData?.user_id || decodedToken?.id,
        name: userData?.name || decodedToken?.name || '',
        email: userData?.email || decodedToken?.email || '',
        role: userData?.role || decodedToken?.role || 'user',
        login:
          userData?.username ||
          decodedToken?.login ||
          decodedToken?.username ||
          '',
      })
      setIsAuthenticated(true)
      localStorage.setItem('token', token)
      // Сохраняем роль отдельно, так как она может не быть в токене
      if (userData?.role) {
        localStorage.setItem('user_role', userData.role)
      }
    }
  }

  const logout = () => {
    setUser(null)
    setIsAuthenticated(false)
    localStorage.removeItem('token')
    localStorage.removeItem('user_role')
  }

  // При инициализации проверяем сохраненные данные
  useState(() => {
    const token = localStorage.getItem('token')
    const savedRole = localStorage.getItem('user_role')
    if (token) {
      const decodedToken = decodeJWT(token)
      if (decodedToken) {
        setUser({
          id: decodedToken.id,
          name: decodedToken.name || '',
          email: decodedToken.email || '',
          role: savedRole || decodedToken.role || 'user',
          login: decodedToken.login || decodedToken.username || '',
        })
        setIsAuthenticated(true)
      }
    }
  })

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

// Вспомогательная функция для декодирования JWT
const decodeJWT = (token: string) => {
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
    console.error('Error decoding JWT:', error)
    return null
  }
}
