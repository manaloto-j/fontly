import { useState } from 'react'
import Home from './pages/Home'
import Editor from './pages/Editor'

type Page = 'home' | 'editor'

export default function App() {
  const [page, setPage] = useState<Page>('home')

  return (
    <>
      {page === 'home' && <Home onStart={() => setPage('editor')} />}
      {page === 'editor' && <Editor onBack={() => setPage('home')} />}
    </>
  )
}
