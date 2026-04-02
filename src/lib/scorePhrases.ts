import { Phrase, DifficultyScore } from '@/types'

// ─── CEFR vocabulary scoring ───────────────────────────────────────────────────
//
// Uses SUBTLEX-US word frequency rankings (open-licensed).
// Words in the top 1000 most common = A1/A2 (very easy).
// Words in the top 5000 = B1/B2 (intermediate).
// Words outside top 5000 = C1/C2 (advanced).
//
// We approximate this with a hard-coded set of the ~800 most common English words.
// A more complete implementation would load the full SUBTLEX-US dataset.
// This is sufficient for MVP difficulty sorting.

const COMMON_WORDS_A1 = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','up','about','into','through','during','before','after','above','below',
  'between','each','few','more','most','other','some','such','than','too','very',
  'just','can','will','would','should','could','may','might','must','shall',
  'have','has','had','do','does','did','be','is','are','was','were','been','being',
  'i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','this','that','these','those',
  'what','which','who','when','where','why','how','all','any','both','no','not',
  'if','then','because','as','so','yet','still','also','again','here','there',
  'now','only','even','back','well','way','come','go','get','make','know','take',
  'see','look','want','give','use','find','tell','ask','seem','feel','try','leave',
  'call','keep','let','put','mean','become','show','hear','play','run','move','live',
  'say','said','says','think','thought','thought','work','day','time','year','good',
  'new','first','last','long','great','little','own','right','big','high','different',
  'small','large','next','early','young','important','public','private','real','best',
  'free','sure','far','hand','place','case','week','company','system','program','question',
  'point','city','name','fact','room','lot','side','kind','four','five','six','one',
  'two','three','ten','hundred','thousand','part','add','per','man','woman','child',
  'world','life','country','city','group','number','people','need','old','old',
  'home','water','family','area','school','state','story','help','problem','away',
  'start','end','set','stop','open','close','follow','move','create','change',
  'plan','start','top','down','over','never','always','often','possible','able',
  'same','long','around','however','another','under','while','full','without',
  'us','every','example','together','process','morning','evening','today','yesterday',
])

const COMMON_WORDS_B = new Set([
  'achieve','acquire','adapt','adequate','adjacent','administration','advantage',
  'affect','agency','aggregate','alternative','analyse','analyze','apparent','approach',
  'appropriate','approximately','aspect','assess','assume','authority','available',
  'benefit','category','chapter','chemical','circumstance','clause','code','commission',
  'community','complex','component','concept','conclude','conduct','consequence',
  'consider','consistent','constant','construct','context','contract','contribute',
  'controversy','convey','create','criteria','culture','cycle','data','decade',
  'define','demonstrate','design','detail','determine','develop','device','distribute',
  'document','economy','element','environment','establish','evaluate','evidence',
  'evolution','examine','exist','expand','experience','explain','factor','feature',
  'finance','focus','foundation','function','generate','global','goal','grant',
  'identify','impact','implement','indicate','individual','initial','institution',
  'integrate','interpret','involve','issue','labor','legal','maintain','major',
  'method','minor','negative','normal','obtain','occur','option','output','overall',
  'participate','percent','period','physical','policy','positive','potential',
  'principle','process','produce','professional','project','promote','provide',
  'publish','purchase','range','ratio','region','regulate','relate','release',
  'require','research','resource','respond','restrict','result','reveal','role',
  'section','select','significant','similar','source','specific','strategy','structure',
  'style','support','survey','technique','technology','theory','tradition','transfer',
  'trend','unique','utilize','version','volume',
])

function getWordDifficulty(word: string): number {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!lower) return 0
  if (COMMON_WORDS_A1.has(lower)) return 0.1   // A1/A2 — very common
  if (COMMON_WORDS_B.has(lower)) return 0.5    // B1/B2 — intermediate
  return 0.9                                    // C1/C2 — advanced (not in lists)
}

// Count syllables via vowel cluster approximation
function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!cleaned) return 0
  const vowelGroups = cleaned.match(/[aeiouy]+/g)
  const count = vowelGroups?.length ?? 1
  // Silent 'e' at end: subtract 1 if word ends in vowel+consonant+e
  const silentE = /[aeiouy][^aeiouy]e$/.test(cleaned) ? 1 : 0
  return Math.max(1, count - silentE)
}

// ─── Main scoring function ─────────────────────────────────────────────────────
export function scorePhrase(phrase: Phrase): DifficultyScore {
  const words = phrase.text.split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const duration = Math.max(phrase.duration, 0.1)

  // 1. WPM (words per minute)
  const wpm = (wordCount / duration) * 60
  // Normalize: 80wpm = easy (0.0), 160wpm = medium (0.5), 220wpm+ = hard (1.0)
  const wpmNorm = Math.min(1, Math.max(0, (wpm - 80) / 140))

  // 2. Vocabulary score (average word difficulty)
  const vocabScore = words.length > 0
    ? words.reduce((sum, w) => sum + getWordDifficulty(w), 0) / words.length
    : 0.5

  // 3. Phoneme density (syllables per second)
  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0)
  const syllablesPerSec = totalSyllables / duration
  // Normalize: 2/sec = easy (0.0), 5/sec = medium (0.5), 8/sec+ = hard (1.0)
  const phonemeNorm = Math.min(1, Math.max(0, (syllablesPerSec - 2) / 6))

  // 4. Weighted final score
  const normalized = wpmNorm * 0.4 + vocabScore * 0.4 + phonemeNorm * 0.2

  const overall: DifficultyScore['overall'] =
    normalized < 0.35 ? 'easy' : normalized < 0.65 ? 'medium' : 'hard'

  return { wpm: Math.round(wpm), vocabScore, phonemeScore: phonemeNorm, overall, normalized }
}

// Score all phrases (memoize-friendly: pure function)
export function scorePhrases(phrases: Phrase[]): Phrase[] {
  return phrases.map((p) => ({ ...p, difficulty: scorePhrase(p) }))
}
