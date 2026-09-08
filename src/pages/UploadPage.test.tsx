import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UploadPage from './UploadPage'
import { useStore } from '../store/useStore'

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ playerDict: {}, quarterMeta: null })
})

describe('UploadPage', () => {
  it('offers quarter annotation as the only mode', () => {
    render(<UploadPage onQuarter={vi.fn()} onCompare={vi.fn()} />)
    expect(screen.getByText('Annotate Quarter')).toBeInTheDocument()
    // Possession mode was removed — it must not reappear in the UI.
    expect(screen.queryByText(/Annotate Ball Possession/i)).not.toBeInTheDocument()
    // The video splitter was deleted along with its server.
    expect(screen.queryByText(/Video Quarter Splitter/i)).not.toBeInTheDocument()
  })

  it('drops a cached player CSV that no longer parses instead of trusting it', () => {
    localStorage.setItem('pdata_csv', 'not,a,valid,player,file\n')
    localStorage.setItem('pdata_name', 'bad.csv')
    render(<UploadPage onQuarter={vi.fn()} onCompare={vi.fn()} />)
    expect(localStorage.getItem('pdata_csv')).toBeNull()
    expect(localStorage.getItem('pdata_name')).toBeNull()
  })
})
