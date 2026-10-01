import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State { error: Error | null }

/** Last-resort guard: a render error must not leave an empty application root. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('DC-Resilience render error', error, info.componentStack)
  }

  private reset = () => {
    try { localStorage.removeItem('dc-resilience-facility-layout-v1') } catch { /* ignore */ }
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="panel error-boundary" role="alert">
        <h2>Something went wrong rendering this page</h2>
        <p>{this.state.error.message || 'An unexpected error occurred.'}</p>
        <p className="subtle">Your saved experiments are untouched. Reset the facility model below, or reload the page.</p>
        <div className="error-boundary-actions">
          <button className="button" onClick={this.reset}>Reset facility model</button>
          <button className="button primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
