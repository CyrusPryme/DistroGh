import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('Button (native)', () => {
  it('should render children correctly', () => {
    render(<button>Click me</button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })

  it('should handle click events', () => {
    const handleClick = vi.fn()
    render(<button onClick={handleClick}>Click me</button>)

    const button = screen.getByRole('button', { name: /click me/i })
    button.click()

    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
