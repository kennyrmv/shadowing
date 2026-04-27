#!/usr/bin/env python3
# fetch_transcript.py
# Called by fetchTranscript.ts as a subprocess.
# Usage: python3 fetch_transcript.py <videoId>
# Outputs JSON to stdout: [{"text": "...", "offset": ms, "duration": ms}, ...]

import sys
import json
import os


def make_api(use_proxy=True):
    """Build YouTubeTranscriptApi with proxy (server) or browser cookies (local)."""
    from youtube_transcript_api import YouTubeTranscriptApi

    # Server: use Webshare proxy — try argv first (passed by Node.js), then env var
    proxy_user = (sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None) or os.environ.get('NEXT_PUBLIC_WEBSHARE_PROXY_USER')
    proxy_pass = (sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None) or os.environ.get('NEXT_PUBLIC_WEBSHARE_PROXY_PASS')
    if use_proxy and proxy_user and proxy_pass:
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
            print(f"[DEBUG] WebshareProxyConfig import failed: {e}", file=sys.stderr)
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

    # Clear any system proxy env vars that could hijack the bare client
    for var in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'):
        os.environ.pop(var, None)

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

    def fetch_with_api(use_proxy):
        api = make_api(use_proxy=use_proxy)
        transcript_list = api.list(video_id)
        try:
            transcript = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
        except NoTranscriptFound:
            transcript = transcript_list.find_generated_transcript(['en'])
        data = transcript.fetch()
        return [
            {
                "text": snippet.text,
                "offset": int(snippet.start * 1000),
                "duration": int(snippet.duration * 1000)
            }
            for snippet in data
            if snippet.text.strip()
        ]

    try:
        try:
            result = fetch_with_api(use_proxy=True)
        except (TranscriptsDisabled, VideoUnavailable, NoTranscriptFound):
            raise  # don't retry these — they won't change without a proxy
        except Exception as proxy_err:
            proxy_user = (sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None) or os.environ.get('NEXT_PUBLIC_WEBSHARE_PROXY_USER')
            print(f"[DEBUG] proxy attempt failed (proxy_user={'SET' if proxy_user else 'NOT_SET'}): {proxy_err}", file=sys.stderr)
            print(f"[DEBUG] retrying without proxy...", file=sys.stderr)
            result = fetch_with_api(use_proxy=False)

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
        proxy_user = (sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None) or os.environ.get('NEXT_PUBLIC_WEBSHARE_PROXY_USER')
        print(json.dumps({"error": f"[proxy={'SET' if proxy_user else 'NOT_SET'}] {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
