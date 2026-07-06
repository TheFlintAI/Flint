export function DepthGuides({ depth }: { depth: number }): React.JSX.Element | null {
  if (depth <= 0) return null

  return (
    <div className="absolute inset-y-0 left-0 pointer-events-none">
      {Array.from({ length: depth }).map((_, index) => (
        <span
          key={index}
          className="workspace-filetree-guide absolute inset-y-0 w-px"
          style={{ left: `${index * 14 + 9}px` }}
        />
      ))}
    </div>
  )
}
