# Design System — Shadowing

## Product Context
- **What this is:** A language learning tool for pronunciation practice via audio shadowing. Users loop video phrases, record themselves, and get pronunciation + prosody feedback.
- **Who it's for:** Adult language learners who want to improve pronunciation, rhythm, and intonation by shadowing native speakers from YouTube content.
- **Space/industry:** Language learning (peers: Duolingo, ELSA Speak, Speechling, Cake)
- **Project type:** Web app (Next.js, mobile-first responsive)

## Aesthetic Direction
- **Direction:** Playful/Clean — Duolingo's layout discipline and focus with a more mature, audio-oriented palette. Rounded, friendly, generous white space.
- **Decoration level:** Minimal — typography and spacing do the work. No decorative elements, gradients, or background patterns.
- **Mood:** Calm, focused, encouraging. Each screen does ONE thing. The learner should feel guided, not overwhelmed. Like a patient tutor, not a dashboard.
- **Reference sites:** Duolingo (design.duolingo.com), ELSA Speak, Cake (mycake.me)

## Typography
- **Display/Hero:** Nunito (weight 700-800) — rounded terminals, warm, playful but professional. Similar energy to Duolingo's DIN Next Rounded. Free and open-source.
- **Body:** DM Sans (weight 300-600) — geometric, clean, excellent readability at small sizes.
- **UI/Labels:** DM Sans 500-600 at 11-13px
- **Data/Tables:** DM Sans (font-variant-numeric: tabular-nums) — for scores, times, stats
- **Code:** Geist Mono
- **Loading:** Google Fonts `family=Nunito:wght@600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700`
- **Scale:**
  - xs: 11px (meta, timestamps)
  - sm: 13px (labels, secondary text)
  - base: 15px (body text)
  - lg: 17px (phrase text, active content)
  - xl: 20px (section headings)
  - 2xl: 24px (stat values)
  - 3xl: 28px (page titles, hero)
  - 4xl: 36px (display, app name)

## Color
- **Approach:** Restrained — one primary accent + neutrals. Color is rare and meaningful.
- **Primary:** #0EA5E9 (sky blue) — suggests sound, waves, communication. Differentiates from Duolingo's green. Active states, CTAs, links.
- **Primary Dark:** #0284C7 — hover states, pressed states
- **Primary Light:** #E0F2FE — active phrase background, info alerts, selected states
- **Secondary:** #F59E0B (warm amber) — streaks, achievements, warmth. The "reward" color.
- **Secondary Light:** #FEF3C7 — secondary backgrounds
- **Neutrals:**
  - Text: #1F2937 (primary content, headings)
  - Secondary: #6B7280 (labels, secondary text)
  - Muted: #9CA3AF (timestamps, meta, hints)
  - Border: #E5E7EB (card borders, dividers)
  - Surface: #F3F4F6 (card backgrounds, toggle bars, input backgrounds)
  - Background: #FFFFFF (page background)
- **Semantic:**
  - Success: #22C55E / light: #DCFCE7 — good scores (80+), "easy" rating, saved states
  - Warning: #EAB308 / light: #FEF9C3 — medium scores (50-79), "good" rating
  - Error: #EF4444 / light: #FEE2E2 — low scores (<50), "hard" rating, errors
  - Info: #0EA5E9 / light: #E0F2FE — tips, active states (reuses primary)
- **Dark mode strategy:** Invert surfaces (bg: #111827, surface: #1F2937), reduce color saturation 10-20%, swap text to #F9FAFB. Primary shifts to #38BDF8 (lighter sky).

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable — generous white space, breathing room between elements
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)
- **Component spacing:**
  - Between cards: 12px
  - Card internal padding: 16px
  - Section spacing: 24-32px
  - Tab bar padding: 8px outer, 8px inner per tab

## Layout
- **Approach:** Grid-disciplined — single column, max-width constrained, predictable alignment
- **Grid:** Single column centered, no sidebar
- **Max content width:** 480px (mobile-first, reads well on desktop too)
- **Border radius:**
  - sm: 8px (buttons, inputs, toggle bars, speed pills)
  - md: 12px (cards, phrase cards, alerts, video player)
  - lg: 16px (tab container, modal sheets)
  - full: 9999px (pills, badges, loop badge, "change video" button)

## Navigation
- **3 tabs:** Dashboard / Practice / Daily
  - Tab bar: pill-style container (bg: surface, radius: lg), active tab gets white bg + shadow
  - Tab text: 13px DM Sans 500, muted when inactive, dark when active
- **URL bar:** Hidden by default. Replaced by a small "Change video" pill button in the header (right-aligned). Clicking it reveals the URL input as an expandable overlay or inline field.

## UX Patterns

### Practice Flow (sequential, not stacked)
1. Video player with loop badge overlay ("Looping" / "3/5" in drill mode)
2. Collapsible "Video settings" toggle (start from, speed, drill) — closed by default
3. **Single** "Now looping" phrase card (sky blue bg) — no duplicate
4. "Hold to speak" CTA button (primary, full-width)
5. After assessment, results appear in order:
   - Pronunciation scores (Accuracy, Fluency, Completeness) in a success-colored card
   - Prosody match (overall score + Intonation/Rhythm/Stress) with pitch contour and rhythm dots
   - Rating buttons (Hard/Good/Easy) appear LAST — after seeing all feedback
6. Phrase list below

### Extraction Mode
- When user extracts clips, hide non-extracted phrases from the list
- Show only extracted clips for focused practice
- "Exit focused mode" button to return to full list

### Dashboard
- Stats row: streak (amber), today count (primary), 30-day total (default)
- Heatmap card
- Score trend card (when enough data)
- Weak words section

## Motion
- **Approach:** Intentional — subtle transitions that aid comprehension, no bouncy/playful animation
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms)
- **Transitions:**
  - Tab changes: 200ms ease
  - Card hover: 150ms ease
  - Collapsible toggle: 200ms ease-in-out
  - State changes (loop badge, button states): 150ms

## Component Reference

### Prosody Visualizations
- **Pitch contour:** SVG with native line (primary blue) and user line (amber). Background: surface, radius: sm, padding: 12px
- **Rhythm dots:** SVG with native dots (primary blue, top row) and user dots (amber, bottom row). Center divider line. Same container style as pitch contour.
- **Legend:** Inline flex, 11px, colored circles matching the lines

### Score Cards
- Grid of 3 columns, each with value (font-display 20px bold) + label (11px muted)
- Background: surface. Color-coded by score value (success/warning/error thresholds: 80/50)

### Rating Buttons
- Flex row of 3, equal width
- Hard: error-light bg, error text
- Good: warning-light bg, dark amber text
- Easy: success-light bg, dark green text
- Suggested rating gets filled (solid bg, white text)

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-04 | Initial design system created | Created by /design-consultation based on competitive research (Duolingo, ELSA Speak) and user's request for Duolingo-inspired clean UX |
| 2026-04-04 | Sky blue (#0EA5E9) as primary instead of green | Differentiates from Duolingo, signals "audio/voice/sound" |
| 2026-04-04 | Nunito + DM Sans typography stack | Rounded warmth (Nunito) for display + geometric clarity (DM Sans) for body. Free alternatives to Duolingo's proprietary fonts |
| 2026-04-04 | 3-tab navigation (Dashboard/Practice/Daily) | Separates concerns, reduces visual chaos. Dashboard stats were cluttering the practice flow |
| 2026-04-04 | Hidden URL bar with "Change video" button | URL bar is a one-time action, shouldn't occupy permanent screen space |
| 2026-04-04 | Collapsible video settings | Start-from, speed, drill are power-user controls — hide by default |
| 2026-04-04 | Sequential post-assessment flow | Pronunciation scores, then prosody match, then rating. Not stacked/parallel. Cleaner and gives each feedback type its own moment |
| 2026-04-04 | Extraction mode hides other phrases | Focused practice on extracted clips without visual noise from the full phrase list |
