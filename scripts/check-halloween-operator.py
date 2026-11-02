"""Operator client contract: mock transport only, never a live endpoint."""
import contextlib, io, json, os, runpy, tempfile
from unittest.mock import patch

path = 'scripts/halloween-reward-operator.py'
env = {'TERRITORY_SUPABASE_URL': 'https://operator.invalid', 'TERRITORY_SUPABASE_ANON_KEY': 'example-anon', 'TERRITORY_OWNER_TOKEN': 'example-owner-secret'}
snapshot = {'eligible': 2, 'digest': 'a' * 32, 'unexpected': 0, 'duplicates': 0}
status = {'snapshot': snapshot, 'audit': {'unfinished': 0}}
seen = []
class Response(io.BytesIO):
    def __init__(self, value): super().__init__(json.dumps(value).encode())

def run(args, reply):
    out = io.StringIO()
    def fake_open(req, timeout):
        seen.append(json.loads(req.data))
        return Response(reply)
    with patch.dict(os.environ, env, clear=True), patch('sys.argv', [path, *args]), patch('urllib.request.urlopen', fake_open), contextlib.redirect_stdout(out):
        runpy.run_path(path, run_name='__main__')
    assert env['TERRITORY_OWNER_TOKEN'] not in out.getvalue()
    return json.loads(out.getvalue())

assert run(['preview'], status) == status
assert seen[-1]['action'] == 'halloween_reward_status'
with tempfile.NamedTemporaryFile(mode='w+', encoding='utf8') as file:
    json.dump(status, file); file.flush()
    receipt = {'inserted': 2, 'alreadyProcessed': False}
    result = run(['grant', '--preview-file', file.name, '--request-id', '00000000-0000-0000-0000-000000000001'], receipt)
    assert result == receipt and seen[-1]['eligible'] == 2 and seen[-1]['digest'] == 'a' * 32
    file.seek(0); file.truncate(); json.dump({'snapshot': snapshot, 'audit': {'unfinished': 1}}, file); file.flush()
    before = len(seen)
    try: run(['grant', '--preview-file', file.name, '--request-id', '00000000-0000-0000-0000-000000000001'], receipt)
    except SystemExit: pass
    else: raise AssertionError('unfinished attempt must block another grant')
    assert len(seen) == before
print('Operator client contract passed: preview, exact snapshot, token redaction, unfinished-attempt stop.')
