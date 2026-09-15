export const MASCOTS = [
  // Animals
  'bear',
  'bunny',
  'cat',
  'deer',
  'dino',
  'fox',
  'frog',
  'hamster',
  'hedgehog',
  'koala',
  'otter',
  'owl',
  'panda',
  'penguin',
  'pug',
  'raccoon',
  'redpanda',
  'sheep',
  'sloth',
  'tiger',

  // People
  'afro',
  'astronaut',
  'bald',
  'ballerina',
  'beard',
  'builder',
  'cap',
  'chef',
  'glasses',
  'grandpa',
  'granny',
  'hijabi',
  'kamran',
  'nurse',
  'pirate',
  'scientist',
  'sikh',
  'skater',
  'wizard',

  // Robots
  'clockwork',
  'crt',
  'cube',
  'drone',
  'gearbot',
  'knight',
  'lantern',
  'postbot',
  'radio',
  'rocket',
  'scout',
  'toaster',
  'tv',
] as const

export type MascotName = (typeof MASCOTS)[number]

export const MASCOT: MascotName = 'fox'

export const STYLES = [
  { name: 'colour', character: 'fox', note: 'the default' },
  { name: 'ink', character: 'fox-ink', note: 'black line' },
  { name: 'sketch', character: 'fox-sketch', note: 'pencil' },
  { name: 'riso', character: 'fox-riso', note: 'two-tone print' },
  { name: 'paper', character: 'fox-paper', note: 'cut paper' },
  { name: 'pixel', character: 'fox-pixel', note: '32 across' },
]

export function sheets(character: string) {
  return {
    directions: `${import.meta.env.BASE_URL}mascots/${character}-directions.webp`,
    reactions: `${import.meta.env.BASE_URL}mascots/${character}-reactions.webp`,
  }
}
