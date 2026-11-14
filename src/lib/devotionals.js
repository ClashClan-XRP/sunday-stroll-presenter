// Builds a 7-day devotional plan that follows the presentation theme.
// Scripture is stored as structured fields (book / chapter / verses / version).
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DEFAULT_THEME = 'Ephesians 5 - Be imitators of God and walk in love'
export const VERSIONS = ['ESV', 'NIV', 'NKJV', 'KJV', 'NASB', 'CSB', 'NLT', 'AMP']
export const BOOKS = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation']

const REF = /\b((?:[1-3]\s?)?[A-Z][a-z]+)\s+(\d+):(\d+)(?:\s?[-–]\s?(\d+))?/

export function parseRef(text, version = 'ESV') {
  const m = (text || '').match(REF)
  if (!m) return null
  const book = BOOKS.find(b => b.toLowerCase() === m[1].replace(/\s+/, ' ').toLowerCase())
  if (!book) return null
  return { book, chapter: Number(m[2]), verseStart: Number(m[3]), verseEnd: m[4] ? Number(m[4]) : null, version }
}

export function formatRef(r) {
  if (!r) return ''
  const v = r.verseEnd && r.verseEnd !== r.verseStart ? `${r.verseStart}-${r.verseEnd}` : `${r.verseStart}`
  return `${r.book} ${r.chapter}:${v}${r.version ? ` (${r.version})` : ''}`
}

export function passageUrl(r) {
  const v = r.verseEnd && r.verseEnd !== r.verseStart ? `${r.verseStart}-${r.verseEnd}` : `${r.verseStart}`
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(`${r.book} ${r.chapter}:${v}`)}&version=${r.version || 'ESV'}`
}

export function detectTheme(slides) {
  const first = slides[0]
  if (!first) return DEFAULT_THEME
  const sub = (first.body || '').split('\n').find(l => l.trim())
  return sub ? sub.trim() : DEFAULT_THEME
}

const cleanTitle = t => (t || '').replace(/^\s*\d+[.)]\s*/, '').trim()
const FALLBACK = { book: 'Ephesians', chapter: 5, verseStart: 1, verseEnd: 2 }

export function generateDevotionals(slides, theme, version = 'ESV') {
  const points = slides
    .map(s => ({ s, ref: parseRef(`${s.title}\n${s.body}`, version) }))
    .filter(x => x.ref)
  return DAYS.map((day, i) => {
    const pt = points[i]
    if (pt) {
      const lines = (pt.s.body || '').split('\n').map(l => l.trim()).filter(l => l && !parseRef(l))
      const title = cleanTitle(pt.s.title) || `Day ${i + 1}`
      return {
        day, title, ref: pt.ref,
        reflection: `${lines.join(' ')} This week's theme is "${theme}". Read ${formatRef({ ...pt.ref, version: '' })} slowly and ask: where can I imitate God and walk in love today?`.trim(),
        prayer: `Father, make me an imitator of You. Help me live out "${title}" today, walking in love as Christ loved me. Amen.`,
        action: lines[lines.length - 1] || 'Do one deliberate act of Christ-like love today.'
      }
    }
    return {
      day, ref: { ...FALLBACK, version },
      title: i === 6 ? 'Rest and Remember' : `Walk in Love - Day ${i + 1}`,
      reflection: `Look back over the week's theme, "${theme}". Where did you see God's love at work through you, and where do you still need His help?`,
      prayer: 'Lord, thank You for loving me first. Teach me to walk in love. Amen.',
      action: 'Write down one way you walked in love this week and share it with someone.'
    }
  })
}

// Dates for each devotional day, given the Sunday the sermon is preached (weekOf).
export function dayDate(weekOf, i) {
  if (!weekOf) return ''
  const d = new Date(`${weekOf}T12:00:00`)
  d.setDate(d.getDate() + 1 + i) // Monday after the sermon Sunday ... following Sunday
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function devotionalText(d) {
  return `${d.day}: ${d.title}\n${formatRef(d.ref)}\n\n${d.reflection}\n\nPrayer: ${d.prayer}\nToday: ${d.action}\n`
}
