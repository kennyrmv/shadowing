# TODOS

## P1 — Do when triggered

### YouTube Data API v3 migration
**What:** Replace `@danielxceron/youtube-transcript` (unofficial scraper) with YouTube's official Data API v3.
**Why:** The scraper violates YouTube ToS (Section 5.1.J) and has low maintenance activity. YouTube has broken these scrapers before (2023-2024). If it breaks, the entire app goes down.
**Trigger:** When scraper is non-functional for >7 days, OR when first 100 users appear.
**How to start:** Get a Google API key at console.cloud.google.com → enable YouTube Data API v3 → use `captions.list` endpoint. Replace the `/api/transcript` route.
**Pros:** Official, stable, supported. Removes legal risk.
**Cons:** Requires API key, 10,000 units/day free tier, OAuth setup for private captions.
**Effort:** M (human: ~1 day / CC: ~45 min)
**Depends on:** Nothing — can be swapped independently.

---

## P2 — Do after validation

## P3 — Nice to have

### Native waveform comparison (Whisper-based)
**What:** Download YouTube audio, extract the phrase's audio segment, display it alongside the user's recording waveform.
**Why:** Full shadowing feedback — users can visually see where their rhythm/stress differs from the native speaker. CORS blocks this in v1.
**Decision trigger:** Add this when users explicitly ask for "compare with native speaker" comparison. Validate demand first.
**How to start:** yt-dlp for audio download → ffmpeg to clip phrase segment → Whisper for transcript alignment → WaveSurfer for dual waveform display.
**Pros:** Complete shadowing feedback loop. Differentiating feature.
**Cons:** Requires audio download (YouTube ToS gray area), storage costs, Whisper API (~$0.006/min).
**Effort:** L (human: ~1 week / CC: ~2 hours)
**Depends on:** YouTube Data API v3 migration (TODO #1 above).
