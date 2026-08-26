# Stealth Article Reader (Multi-Platform)

Isolated Camoufox-based CLI for reading web articles when `web_fetch` fails.
Accepts any HTTP/HTTPS URL. Uses Camoufox stealth browser to bypass
anti-bot protections.

Run from the service directory with the isolated environment:

```bash
# Basic usage
../../.venv-stealth-reader/bin/python -m stealth_reader 'https://example.com/article'

# With SSL ignore (for sites like nlypx.com with invalid certs)
../../.venv-stealth-reader/bin/python -m stealth_reader --ignore-ssl 'https://www.nlypx.com/...'

# Headed mode (requires X11 display)
../../.venv-stealth-reader/bin/python -m stealth_reader --headed 'https://...'
```

The CLI prints one JSON object to stdout. Non-success states exit with code 2.
Every browser attempt is archived under `data/articles/`.

## Status Codes

- `SUCCESS` — article extracted with content
- `RETRYABLE` — transient error, can retry
- `NEED_VERIFY` — captcha/verification required
- `EMPTY` — page loaded but no meaningful content found
- `UNSUPPORTED` — invalid URL scheme

## Usage as web_fetch fallback

When `web_fetch` fails, try this script. If it also fails, try with `--ignore-ssl`.

Run tests:

```bash
PYTHONPATH=. ../../.venv-stealth-reader/bin/python -m unittest discover -s tests -v
```