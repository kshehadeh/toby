/**
 * Global notice (ToastView): a Liquid Glass slab, max 420px.
 */
export interface ToastProps {
  style?: 'success' | 'error' | 'progress';
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}
export declare function Toast(props: ToastProps): JSX.Element;
