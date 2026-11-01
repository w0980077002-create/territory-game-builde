#!/usr/bin/env python3
"""Owner-only staged operator client. Never stores credentials or prints tokens."""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description='Review the release runbook before using this operator client.')
parser.add_argument('command', choices=('preview', 'reconcile', 'grant'))
parser.add_argument('--preview-file', help='File produced by preview; required for grant')
parser.add_argument('--request-id', help='Stable UUID for idempotent grant and retry')
args = parser.parse_args()
url = os.environ.get('TERRITORY_SUPABASE_URL', '').rstrip('/')
api_key = os.environ.get('TERRITORY_SUPABASE_ANON_KEY', '')
token = os.environ.get('TERRITORY_OWNER_TOKEN', '')
if not url.startswith('https://') or not api_key or not token:
    sys.exit('Set TERRITORY_SUPABASE_URL, TERRITORY_SUPABASE_ANON_KEY and TERRITORY_OWNER_TOKEN in the protected operator environment.')
body = {'action': 'halloween_reward_status', 'token': token}
if args.command == 'grant':
    if not args.preview_file or not args.request_id:
        sys.exit('Grant requires --preview-file and a stable --request-id UUID.')
    try:
        request_id = str(uuid.UUID(args.request_id))
        with open(args.preview_file, encoding='utf-8') as file:
            preview = json.load(file)
        snapshot, audit = preview['snapshot'], preview['audit']
        eligible, digest = snapshot['eligible'], snapshot['digest']
        if (type(eligible) is not int or eligible < 0 or not isinstance(digest, str)
            or not re.fullmatch(r'[0-9a-f]{32}', digest) or snapshot['unexpected'] != 0
            or snapshot['duplicates'] != 0 or audit['unfinished'] != 0):
            raise ValueError('unsafe snapshot')
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        sys.exit('Invalid or unsafe preview; stop and reconcile before retrying.')
    body = {'action': 'halloween_reward_bulk', 'token': token, 'requestId': request_id,
            'eligible': eligible, 'digest': digest}
request = urllib.request.Request(url + '/functions/v1/admin-api', data=json.dumps(body).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key}, method='POST')
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)
except (urllib.error.URLError, TimeoutError, ValueError):
    sys.exit('Request failed or outcome is unknown. Disable operations and reconcile before retrying the same request ID.')
if not isinstance(data, dict) or 'error' in data:
    sys.exit('Server refused the operation. Inspect owner-only audit and reconcile before retrying.')
if args.command in ('preview', 'reconcile') and (not isinstance(data.get('audit'), dict) or 'snapshot' not in data):
    sys.exit('Server response is incomplete; stop and investigate.')
print(json.dumps(data, ensure_ascii=False, indent=2))
