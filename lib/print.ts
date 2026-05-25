/**
 * Trigger browser print / Save as PDF.
 * When `targetId` is set, only that element prints (adds `print-only-target` on body).
 */
export function printReport(targetId?: string): void {
  if (typeof window === 'undefined') return

  if (targetId) {
    const el = document.getElementById(targetId)
    if (!el) {
      console.warn(`printReport: element #${targetId} not found`)
      window.print()
      return
    }
    document.body.classList.add('print-only-target')
    const cleanup = () => {
      document.body.classList.remove('print-only-target')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
  }

  window.print()
}
