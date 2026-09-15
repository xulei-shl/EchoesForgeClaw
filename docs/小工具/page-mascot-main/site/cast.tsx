import { Mascot } from '../src/mascot'
import { MASCOTS, sheets } from './mascots'
import { UseButton } from './use-button'

const CELL = 120

type CastProps = {
  picked: string
  onPick: (character: string) => void
  onUse: (character: string) => void
  onMakeYourOwn: () => void
}

export function Cast(props: CastProps) {
  const { picked, onPick, onUse, onMakeYourOwn } = props

  return (
    <section id="characters" className="scroll-mt-16 mt-28 sm:mt-36">
      <h2 className="text-3xl font-bold tracking-tight">{MASCOTS.length} already drawn</h2>
      <p className="mt-3 max-w-[46ch] text-lg leading-snug text-ink/55">
        All of them follow your cursor. Poke one, or hover it and press Use to find out how
        to put it on your page.
      </p>

      <ul
        className="mt-10 grid justify-items-center gap-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CELL}px, 1fr))` }}
      >
        {MASCOTS.map((character) => (
          <li
            key={character}
            className={`group relative flex aspect-square w-full items-center justify-center rounded-2xl transition-colors ${
              character === picked ? 'bg-ink/8' : 'hover:bg-ink/4'
            }`}
          >
            {/* Capture phase, so picking does not swallow the click the mascot needs for
                its own reaction. */}
            <span onClickCapture={() => onPick(character)}>
              <Mascot {...sheets(character)} label={character} size={CELL - 16} />
            </span>

            <UseButton name={character} onClick={() => onUse(character)} />
          </li>
        ))}

        <li className="flex aspect-square w-full items-center justify-center">
          <button
            type="button"
            onClick={onMakeYourOwn}
            className="flex h-full cursor-pointer hover:bg-gray-200 w-full flex-col items-center justify-center gap-1 rounded-2xl border-ink/15 text-ink/40 transition-colors hover:border-ink/35 hover:text-ink/70"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="px-2 text-center text-[13px] leading-tight">Make your own</span>
          </button>
        </li>
      </ul>
    </section>
  )
}
