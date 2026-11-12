import { Component, type ReactNode } from "react";

/** Shows what went wrong instead of a blank window. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>Something went wrong</h2>
        <pre>{this.state.error.message}{"\n\n"}{this.state.error.stack}</pre>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
