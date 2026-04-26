# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1.0] - 2026-04-26

### Changed
- App now opens directly to Today (your daily practice session) when you have saved videos — no more choosing between three tabs before you start
- Renamed "Practice" tab to "Library" to better reflect its purpose: it's where you add and manage YouTube videos, not where you practice
- Dashboard moved out of the tab bar; access it via the streak/level badge in the header (tap to see your week, tap again to go back)
- Tab bar collapses from three tabs to two (Today / Library), removing the decision fatigue of picking where to start every session
- Streak and current difficulty level now visible at a glance in the header when you're on Today
- Badge hides until Zustand hydrates, preventing a flash of incorrect data on load
