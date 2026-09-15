type UseButtonProps = {
  name: string
  onClick: () => void
}

export function UseButton(props: UseButtonProps) {
  const { name, onClick } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-1 rounded-full bg-ink px-2.5 py-1 text-[11px] whitespace-nowrap text-paper opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
    >
      Use {name}
    </button>
  )
}
