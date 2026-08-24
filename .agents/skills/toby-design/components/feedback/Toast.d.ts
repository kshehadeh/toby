/**
 * Floating notice with blurred material background, optional inline action.
 */
export interface ToastProps {
  style?: 'success' | 'error' | 'progress';
  title: string;
  /** Truncated at ~120 characters in the app. */
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}
export declare function Toast(props: ToastProps): JSX.Element;
