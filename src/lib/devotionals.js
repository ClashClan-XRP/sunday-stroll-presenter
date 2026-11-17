// Builds a 7-day devotional plan that follows the presentation theme.
// The week starts on Sunday (the sermon) and runs through Saturday.
// Scripture is stored as structured fields (book / chapter / verses / version).
// A passage that crosses chapters sets endChapter (Ephesians 5:22-6:4).
// Verse text is never invented. If a day has no scripture on the slides, ref is
// null and scriptureFlag says so.
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DEFAULT_THEME = 'Ephesians 5 - Be imitators of God and walk in love'
export const NO_SCRIPTURE = 'No scripture on the slides for this point.'
export const VERSIONS = ['ESV', 'NIV', 'NKJV', 'KJV', 'NASB', 'CSB', 'NLT', 'AMP']
export const BOOKS = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation']

const BOOK = '((?:[1-3]\\s?)?[A-Z][a-z]+)'
const CROSS = new RegExp(`\\b${BOOK}\\s+(\\d+):(\\d+)\\s*[-–]\\s*(\\d+):(\\d+)`)
const SAME = new RegExp(`\\b${BOOK}\\s+(\\d+):(\\d+)(?:\\s*[-–]\\s*(\\d+))?`)

const bookOf = raw => BOOKS.find(b => b.toLowerCase() === String(raw).replace(/\s+/g, ' ').trim().toLowerCase())

export function parseRef(text, version = 'ESV') {
  const src = text || ''
  const cross = src.match(CROSS)
  if (cross) {
    const book = bookOf(cross[1])
    if (book) return { book, chapter: Number(cross[2]), verseStart: Number(cross[3]), endChapter: Number(cross[4]), verseEnd: Number(cross[5]), version }
  }
  const m = src.match(SAME)
  if (!m) return null
  const book = bookOf(m[1])
  if (!book) return null
  return { book, chapter: Number(m[2]), verseStart: Number(m[3]), verseEnd: m[4] ? Number(m[4]) : null, version }
}

const refKey = r => (r ? `${r.book}|${r.chapter}|${r.verseStart}|${r.verseEnd || ''}|${r.endChapter || ''}` : '')

export function formatRef(r) {
  if (!r?.book || !r.chapter || !r.verseStart) return ''
  let span
  if (r.endChapter && r.endChapter !== r.chapter) span = `${r.chapter}:${r.verseStart}-${r.endChapter}:${r.verseEnd}`
  else {
    const v = r.verseEnd && r.verseEnd !== r.verseStart ? `${r.verseStart}-${r.verseEnd}` : `${r.verseStart}`
    span = `${r.chapter}:${v}`
  }
  return `${r.book} ${span}${r.version ? ` (${r.version})` : ''}`
}

export function scriptureLabel(d) {
  if (d?.ref?.book && d.ref.chapter && d.ref.verseStart) return formatRef(d.ref)
  return d?.scriptureFlag || NO_SCRIPTURE
}

export function passageUrl(r) {
  if (!r?.book || !r.chapter || !r.verseStart) return ''
  const span = r.endChapter && r.endChapter !== r.chapter
    ? `${r.chapter}:${r.verseStart}-${r.endChapter}:${r.verseEnd}`
    : `${r.chapter}:${r.verseEnd && r.verseEnd !== r.verseStart ? `${r.verseStart}-${r.verseEnd}` : r.verseStart}`
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(`${r.book} ${span}`)}&version=${r.version || 'ESV'}`
}

export function detectTheme(slides) {
  const first = slides[0]
  if (!first) return DEFAULT_THEME
  const sub = (first.body || '').split('\n').find(l => l.trim())
  return sub ? sub.trim() : DEFAULT_THEME
}

const cleanTitle = t => (t || '').replace(/^\s*\d+[.)]\s*/, '').trim()

// "Peace on the Family Front - Ephesians 5:22-6:4" -> "Peace on the Family Front"
function themeTitle(theme) {
  const t = (theme || '').trim()
  if (!t) return ''
  return t.replace(/\s+[-–—]\s+(?:[1-3]\s?)?[A-Z][a-z]+\s+\d+:\d+.*$/, '').trim() || t
}

function openDay(day) {
  return {
    day,
    title: day,
    ref: null,
    scriptureFlag: NO_SCRIPTURE,
    reflection: 'The slides do not name a scripture for this day, so none is added here.',
    prayer: 'Lord, keep me in the passage this sermon actually taught. Amen.',
    action: 'Re-read a scripture the slides did name.'
  }
}

export function generateDevotionals(slides, theme, version = 'ESV') {
  const themeRef = parseRef(theme || '', version)
  const used = new Set(themeRef ? [refKey(themeRef)] : [])
  const points = (slides || [])
    .map(s => ({ s, ref: parseRef(`${s.title}\n${s.body}`, version) }))
    .filter(x => x.ref && !used.has(refKey(x.ref)))
  const sundayTitle = themeTitle(theme) || 'This Week\'s Message'
  return DAYS.map((day, i) => {
    if (i === 0) {
      if (!themeRef) return { ...openDay(day), title: sundayTitle }
      return {
        day,
        title: sundayTitle,
        ref: themeRef,
        scriptureFlag: null,
        reflection: `This week's message is "${theme}". Read the passage named here. The wording of the verses is not copied into this devotional.`,
        prayer: `Father, let "${sundayTitle}" take root in our home. Amen.`,
        action: 'Read the Sunday passage once, slowly.'
      }
    }
    const pt = points[i - 1]
    if (!pt) return openDay(day)
    const lines = (pt.s.body || '').split('\n').map(l => l.trim()).filter(l => l && !parseRef(l))
    const title = cleanTitle(pt.s.title) || day
    return {
      day,
      title,
      ref: { ...pt.ref, version },
      scriptureFlag: null,
      reflection: `${lines.join(' ')} This week's theme is "${theme}".`.trim(),
      prayer: `Father, help me live out "${title}" today. Amen.`,
      action: lines[lines.length - 1] || 'Take one step today that fits this slide.'
    }
  })
}

// Dates for each devotional day. weekOf is the Sunday the sermon is preached.
// Index 0 is that Sunday; index 6 is the following Saturday.
export function dayDate(weekOf, i) {
  if (!weekOf) return ''
  const d = new Date(`${weekOf}T12:00:00`)
  d.setDate(d.getDate() + i)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function devotionalText(d) {
  const also = d.also?.length ? `\nAlso named on the slide: ${d.also.join('; ')}` : ''
  return `${d.day}: ${d.title}\n${scriptureLabel(d)}${also}\n\n${d.reflection}\n\nPrayer: ${d.prayer}\nToday: ${d.action}\n`
}
