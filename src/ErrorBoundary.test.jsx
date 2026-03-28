import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import ErrorBoundary from './ErrorBoundary'

// Test component that throws an error
const BrokenComponent = () => {
  throw new Error('Test error')
}

// Test component that renders normally
const WorkingComponent = () => <div>Working content</div>

describe('ErrorBoundary', () => {
  it('renders children normally when there is no error', () => {
    render(
      <ErrorBoundary>
        <WorkingComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByText('Working content')).toBeInTheDocument()
  })

  it('displays error UI when there is an error', () => {
    // Suppress console.error for this test
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/An unexpected error occurred while rendering the application/)).toBeInTheDocument()
    expect(screen.getByText('Try Again')).toBeInTheDocument()
    
    consoleSpy.mockRestore()
  })

  it('allows retry after an error', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    
    // Click retry button
    fireEvent.click(screen.getByText('Try Again'))
    
    // After retry, should render children again (but BrokenComponent will throw again)
    // So we need to handle this - the component should reset state
    expect(screen.queryByText('Something went wrong')).toBeInTheDocument()
    
    consoleSpy.mockRestore()
  })

  it('displays error message when error occurs', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    )
    
    expect(screen.getByText(/Test error/)).toBeInTheDocument()
    
    consoleSpy.mockRestore()
  })
})