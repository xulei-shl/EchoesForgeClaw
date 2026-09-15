import { Mascot } from '../src/mascot'
import { STYLES, sheets } from './mascots'
import { UseButton } from './use-button'

const FROM_PHOTO = { name: 'kamran', character: 'kamran', note: 'from a photo' }

type StylesProps = {
  onUse: (character: string) => void
}

export function Styles(props: StylesProps) {
  const { onUse } = props

  return (
    <section className="mt-28 sm:mt-36">
      <h2 className="text-3xl font-bold tracking-tight">Different styles</h2>
      <p className="mt-3 max-w-[46ch] text-lg leading-snug text-ink/55">
        You can pick from one of the six styles. Or send a photo and get yourself turned into a character.
      </p>

      <ul className="mt-10 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-7">
        {[...STYLES, FROM_PHOTO].map((style) => (
          <li key={style.name} className="group flex flex-col items-start">
            <span className="relative flex aspect-square w-full items-center justify-center rounded-2xl transition-colors hover:bg-ink/4">
              <Mascot {...sheets(style.character)} label={style.name} size={104} />
              <UseButton name={style.name} onClick={() => onUse(style.character)} />
            </span>
            <span className="mt-2 font-mono text-sm font-medium">{style.name}</span>
            <span className="text-sm text-ink/40">{style.note}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
