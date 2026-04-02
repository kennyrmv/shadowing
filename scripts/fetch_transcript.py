#!/usr/bin/env python3
# fetch_transcript.py
# Called by fetchTranscript.ts as a subprocess.
# Usage: python3 fetch_transcript.py <videoId>
# Outputs JSON to stdout: [{"text": "...", "offset": ms, "duration": ms}, ...]

import sys
import json
import os


def make_api():
    """Build YouTubeTranscriptApi with proxy (server) or browser cookies (local)."""
    from youtube_transcript_api import YouTubeTranscriptApi

    # Server: use Webshare proxy — try argv first (passed by Node.js), then env var
    proxy_user = (sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None) or os.environ.get('WEBSHARE_PROXY_USER')
    proxy_pass = (sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None) or os.environ.get('WEBSHARE_PROXY_PASS')
    if proxy_user and proxy_pass:
        try:
            from youtube_transcript_api.proxies import WebshareProxyConfig
            print(f"[DEBUG] Using WebshareProxyConfig with user={proxy_user}", file=sys.stderr)
            return YouTubeTranscriptApi(
                proxy_config=WebshareProxyConfig(
                    proxy_username=proxy_user,
                    proxy_password=proxy_pass,
                )
            )
        except Exception as e:
            print(f"[DEBUG] WebshareProxyConfig failed: {e}", file=sys.stderr)
            pass  # fall through to browser cookies

    # Local dev: use browser cookies via requests session
    try:
        import requests
        import browser_cookie3
        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        })
        for loader in [browser_cookie3.chrome, browser_cookie3.safari, browser_cookie3.firefox]:
            try:
                jar = loader(domain_name='.youtube.com')
                session.cookies = jar
                return YouTubeTranscriptApi(http_client=session)
            except Exception:
                continue
    except ImportError:
        pass

    return YouTubeTranscriptApi()


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
        api = make_api()
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
        proxy_user = os.environ.get('WEBSHARE_PROXY_USER', 'NOT_SET')
        print(json.dumps({"error": f"[proxy_user={proxy_user}] {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
