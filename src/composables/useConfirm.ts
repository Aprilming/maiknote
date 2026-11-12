import { reactive } from 'vue'

export interface ConfirmOptions {
  /** 弹窗标题，留空则用「确认」 */
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  /** 危险操作：确认按钮用红色 */
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((value: boolean) => void) | null
}

// 全局单例：App 里只挂一个 ConfirmDialog，任何地方都能 await confirmAction()
const state = reactive<ConfirmState>({
  open: false,
  title: '',
  message: '',
  confirmText: '',
  cancelText: '',
  danger: true,
  resolve: null,
})

export function useConfirmState(): ConfirmState {
  return state
}

/**
 * 应用内确认框。WKWebView 里 window.confirm 不显示，统一走这个。
 * @returns 用户点「确认」为 true，「取消」/ Esc / 点遮罩为 false
 */
export function confirmAction(options: ConfirmOptions | string): Promise<boolean> {
  // 上一个还没作答就先当取消
  state.resolve?.(false)

  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options
  state.title = opts.title ?? ''
  state.message = opts.message
  state.confirmText = opts.confirmText ?? ''
  state.cancelText = opts.cancelText ?? ''
  state.danger = opts.danger ?? true
  state.open = true

  return new Promise<boolean>((resolve) => {
    state.resolve = resolve
  })
}

export function resolveConfirm(value: boolean) {
  const pending = state.resolve
  state.resolve = null
  state.open = false
  pending?.(value)
}
