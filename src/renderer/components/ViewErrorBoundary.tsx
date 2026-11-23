import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ViewErrorBoundaryProps {
  /** Changing this key (e.g. activeTab) automatically resets any caught error state */
  resetKey: string;
  onFallbackHome?: () => void;
  children: React.ReactNode;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Isolates runtime errors inside an individual section view so navigation,
 * titlebar, and other sections continue working cleanly instead of blanking the app.
 */
export class ViewErrorBoundary extends React.Component<
  ViewErrorBoundaryProps,
  ViewErrorBoundaryState
> {
  constructor(props: ViewErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Errore imprevisto nel rendering della sezione.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ViewErrorBoundary] Rendering error caught:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ViewErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center p-6">
          <div className="glass-panel max-w-md rounded-2xl border border-rose-500/35 p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-400/40 bg-rose-500/15 text-rose-300">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="font-display text-base font-bold text-white">
              Si è verificato un errore in questa sezione
            </h2>
            <p className="mt-1.5 break-words font-mono text-[11px] text-rose-200/90">
              {this.state.errorMessage}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-4 py-2 text-xs font-bold text-slate-950 transition hover:brightness-110"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Riprova
              </button>
              {this.props.onFallbackHome && (
                <button
                  type="button"
                  onClick={() => {
                    this.handleRetry();
                    this.props.onFallbackHome?.();
                  }}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white"
                >
                  Torna a Oddsmatcher
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
