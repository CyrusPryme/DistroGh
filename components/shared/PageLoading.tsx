export function PageLoading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="page-container flex items-center justify-center min-h-[40vh]">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-medium">{label}</span>
      </div>
    </div>
  )
}
