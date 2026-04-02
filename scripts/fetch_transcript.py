#!/usr/bin/env python3
# fetch_transcript.py
# Called by fetchTranscript.ts as a subprocess.
# Usage: python3 fetch_transcript.py <videoId>
# Outputs JSON to stdout: [{"text": "...", "offset": ms, "duration": ms}, ...]

import sys
import json
import os

def make_session():
    """Build a requests.Session with browser cookies (local) or proxy (server)."""
    import requests
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    })

    # On server: use proxy from env var (format: http://user:pass@host:port)
    proxy_url = os.environ.get('YOUTUBE_PROXY')
    if proxy_url:
        session.proxies = {'http': proxy_url, 'https': proxy_url}
        return session

    # Local dev: use browser cookies
    try:
        import browser_cookie3
        for loader in [browser_cookie3.chrome, browser_cookie3.safari, browser_cookie3.firefox]:
            try:
                jar = loader(domain_name='.youtube.com')
                session.cookies = jar
                return session
            except Exception:
                continue
    except ImportError:
        pass

    return session


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No videoId provided"}))
        sys.exit(1)

    video_id = sys.argv[1]

    try:
        from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled, VideoUnavailable
    except ImportError:
        print(json.dumps({"error": "youtube-transcript-api not installed. Run: pip3 install youtube-transcript-api"}))
        sys.exit(1)

    try:
        session = make_session()
        api = YouTubeTranscriptApi(http_client=session) if session else YouTubeTranscriptApi()
        transcript_list = api.list(video_id)

        # Prefer English, fall back to first available
        try:
            transcript = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
        except NoTranscriptFound:
            transcript = transcript_list.find_generated_transcript(['en'])

        data = transcript.fetch()

        result = [
            {
                "text": snippet.text,
                "offset": int(snippet.start * 1000),   # seconds -> ms
                "duration": int(snippet.duration * 1000)
            }
            for snippet in data
            if snippet.text.strip()
        ]

        print(json.dumps(result))

    except TranscriptsDisabled:
        print(json.dumps({"error": "NO_CAPTIONS"}))
        sys.exit(1)
    except VideoUnavailable:
        print(json.dumps({"error": "VIDEO_UNAVAILABLE"}))
        sys.exit(1)
    except NoTranscriptFound:
        print(json.dumps({"error": "NO_CAPTIONS"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
