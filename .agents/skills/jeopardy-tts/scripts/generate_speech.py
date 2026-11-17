#!/usr/bin/env python3
"""Generate/cache a local clue MP3; never connects to the Jeopardy server."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

DEFAULT_INSTRUCTIONS = (
    'Speak in natural, fluent Danish with standard Danish pronunciation. '
    'Use a mature masculine voice with a warm lower register, like a professional '
    'Danish television quiz host. Be calm, confident, engaging and clear, with '
    'restrained expression. Read at a natural conversational pace with flowing '
    'phrasing and no exaggerated pauses. Pronounce English quotations naturally '
    'in English, then continue in Danish where applicable. If the entire supplied '
    'text is an English quotation, read it naturally in English. Read only the '
    'supplied clue text; do not add an introduction, commentary or an answer. '
    'Do not speak quotation marks.'
)


def read_key(path):
    if path.is_file():
        for line in path.read_text().splitlines():
            name, sep, value = line.strip().removeprefix('export ').partition('=')
            if sep and name.strip() == 'OPENAI_API_KEY':
                value = value.strip().strip('\"\'')
                if value:
                    return value
    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not key:
        raise ValueError(f'No API key configured in {path} or OPENAI_API_KEY.')
    return key


def validate_mp3(path):
    data = path.read_bytes()
    if len(data) < 128 or not (
        data.startswith(b'ID3') or (data[0] == 0xFF and data[1] & 0xE0 == 0xE0)
    ):
        raise ValueError('The response is not a nonempty MP3; output was not saved.')
    if not shutil.which('ffprobe'):
        return None
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', str(path)],
        capture_output=True, text=True, timeout=30,
    )
    try:
        duration = float(result.stdout.strip())
    except ValueError:
        duration = 0
    if result.returncode or duration <= 0:
        raise ValueError('Audio decoding/duration check failed; output was not saved.')
    return duration


def synthesize(payload, key):
    request = urllib.request.Request(
        'https://api.openai.com/v1/audio/speech',
        data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read()).get('error', {})
            reason = str(detail.get('message', '')).replace(key, '[REDACTED]')
        except (ValueError, AttributeError):
            reason = 'Request rejected.'
        raise ValueError(f'OpenAI HTTP {error.code}: {reason}') from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError('Speech request failed or timed out. No automatic retry; inspect output before retrying.') from None


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    text = result.add_mutually_exclusive_group(required=True)
    text.add_argument('--text')
    text.add_argument('--text-file', type=Path)
    result.add_argument('--output', type=Path, help='MP3 destination; defaults to a request hash in ~/Downloads/Jeopardy-recordings')
    result.add_argument('--key-file', type=Path, default=Path.home() / '.config/openai/credentials.env')
    result.add_argument('--model', default='gpt-4o-mini-tts')
    result.add_argument('--voice', default='cedar')
    result.add_argument('--speed', type=float, default=1.0)
    result.add_argument('--instructions-file', type=Path)
    result.add_argument('--dry-run', action='store_true', help='Preview without reading credentials or making a request')
    result.add_argument('--overwrite', action='store_true', help='Replace an incompatible local output; does not modify a board')
    return result


def run(args):
    text = (args.text if args.text is not None else args.text_file.expanduser().read_text()).strip()
    if not text:
        raise ValueError('Clue text is empty.')
    if not 0.25 <= args.speed <= 4.0:
        raise ValueError('Speed must be between 0.25 and 4.0.')
    payload = {
        'model': args.model, 'voice': args.voice, 'input': text,
        'instructions': args.instructions_file.expanduser().read_text().strip() if args.instructions_file else DEFAULT_INSTRUCTIONS,
        'speed': args.speed, 'response_format': 'mp3',
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:24]
    output = (args.output or Path.home() / 'Downloads/Jeopardy-recordings' / (digest + '.mp3')).expanduser().resolve()
    if output.suffix.lower() != '.mp3':
        raise ValueError('Output must have an .mp3 extension.')
    if args.dry_run:
        return {'output': str(output), 'request': payload, 'dryRun': True}
    metadata = output.with_suffix('.json')
    if output.exists():
        try:
            saved = json.loads(metadata.read_text())
        except (OSError, ValueError):
            saved = {}
        checksum = hashlib.sha256(output.read_bytes()).hexdigest()
        if saved.get('request') == payload and saved.get('sha256') == checksum:
            return {'output': str(output), 'cached': True, 'durationSeconds': validate_mp3(output)}
        if not args.overwrite:
            raise ValueError(f'Existing output preserved: {output}. Choose another name or explicitly use --overwrite.')
    key = read_key(args.key_file.expanduser())
    data = synthesize(payload, key)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Decode before replacing any existing output. Temp files are removed on failure.
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix='.mp3', delete=False) as file:
        pending = Path(file.name)
        file.write(data)
    try:
        duration = validate_mp3(pending)
        pending.replace(output)
    finally:
        pending.unlink(missing_ok=True)
    manifest = {'request': payload, 'sha256': hashlib.sha256(data).hexdigest(), 'durationSeconds': duration}
    with tempfile.NamedTemporaryFile(mode='w', dir=output.parent, suffix='.json', delete=False) as file:
        pending_meta = Path(file.name)
        json.dump(manifest, file, ensure_ascii=False, indent=2)
    try:
        pending_meta.replace(metadata)
    finally:
        pending_meta.unlink(missing_ok=True)
    return {'output': str(output), 'cached': False, 'durationSeconds': duration}


def main():
    args = parser().parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
