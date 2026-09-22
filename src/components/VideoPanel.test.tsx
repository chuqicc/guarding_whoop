import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VideoPanel from './VideoPanel'
import { useStore } from '../store/useStore'

/** jsdom has no media pipeline; currentTime is a plain property here. */
function video(): HTMLVideoElement {
  return document.querySelector('video') as HTMLVideoElement
}

beforeEach(() => {
  useStore.setState({ videoUrl: 'blob:test', isVideoPlaying: false, playbackSpeed: 1 })
})

describe('VideoPanel sync affordance', () => {
  it('stays out of the way when there is no tracking to anchor against', () => {
    render(<VideoPanel canSync={false} />)
    expect(screen.queryByRole('button', { name: /Sync here/ })).not.toBeInTheDocument()
  })

  it('asks for an anchor when tracking is loaded but none is set', () => {
    render(<VideoPanel canSync syncLabel={null} />)
    expect(screen.getByText(/Scrub to the moment the court is showing/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sync here/ })).toBeInTheDocument()
  })

  it('reports the current video position when pinned', async () => {
    const onPin = vi.fn()
    render(<VideoPanel canSync onPin={onPin} />)
    video().currentTime = 42.5

    await userEvent.click(screen.getByRole('button', { name: /Sync here/ }))
    expect(onPin).toHaveBeenCalledWith(42.5, null)
  })

  it('shows the anchor state and offers to clear or redo it', () => {
    render(<VideoPanel canSync syncLabel="Synced · clip starts +30.0s into the tracking" />)
    expect(screen.getByText(/Synced · clip starts \+30\.0s/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Re-sync/ })).toBeInTheDocument()
    expect(screen.getByTitle(/Forget this anchor/)).toBeInTheDocument()
  })

  it('clears the anchor on request', async () => {
    const onClearSync = vi.fn()
    render(<VideoPanel canSync syncLabel="Synced" onClearSync={onClearSync} />)
    await userEvent.click(screen.getByTitle(/Forget this anchor/))
    expect(onClearSync).toHaveBeenCalled()
  })
})

describe('following the tracking playhead', () => {
  it('seeks the video to the position it is given', () => {
    const { rerender } = render(<VideoPanel canSync syncTime={null} />)
    rerender(<VideoPanel canSync syncTime={12.5} />)
    expect(video().currentTime).toBe(12.5)
  })

  it('does not fight a manual scrub by re-seeking the same value', () => {
    // The guard that matters: without it, every render would yank the video
    // back to the tracking position while the user was dragging it.
    const { rerender } = render(<VideoPanel canSync syncTime={12.5} />)
    expect(video().currentTime).toBe(12.5)

    video().currentTime = 60              // user drags the video
    rerender(<VideoPanel canSync syncTime={12.5} />)
    expect(video().currentTime).toBe(60)  // left alone
  })

  it('follows again once the tracking actually moves', () => {
    const { rerender } = render(<VideoPanel canSync syncTime={12.5} />)
    video().currentTime = 60
    rerender(<VideoPanel canSync syncTime={20} />)
    expect(video().currentTime).toBe(20)
  })

  it('does nothing when there is no anchor', () => {
    render(<VideoPanel canSync syncTime={null} />)
    expect(video().currentTime).toBe(0)
  })
})
