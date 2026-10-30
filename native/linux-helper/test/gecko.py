import http.server, json, os, pathlib, subprocess, sys, threading, time, tempfile
sys.dont_write_bytecode = True
from desktop import Client

assert os.environ.get('GSETTINGS_BACKEND') == 'memory'
run = pathlib.Path(os.environ['CW_GECKO_RUN']).resolve()
assert pathlib.Path(os.environ['XDG_RUNTIME_DIR']).resolve().is_relative_to(run)
state = {'focus': 'normal'}
observed = {}
class Page(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == '/state':
            payload = json.dumps(state).encode()
        else:
            payload = b'''<!doctype html><title>Controlled Gecko fixture</title>
<input id="normal"><div id="rich" contenteditable="true"></div><input id="password" type="password"><div id="plain" tabindex="0">plain</div>
<script>setInterval(async()=>{let s=await(await fetch('/state')).json();let e=document.getElementById(s.focus);e.focus();await fetch('/observed',{method:'POST',body:JSON.stringify({focus:document.activeElement.id,text:e.value??e.textContent})})},100)</script>'''
        self.send_response(200);self.end_headers();self.wfile.write(payload)
    def do_POST(self):
        observed.update(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(200);self.end_headers()
server = http.server.HTTPServer(('127.0.0.1', 0), Page)
threading.Thread(target=server.serve_forever, daemon=True).start()
native = Client([sys.argv[1]])
assert native.read()['event'] == 'ready'
assert native.request('request-permission', kind='accessibility')['accessibility']
profile = pathlib.Path(tempfile.mkdtemp(prefix='profile-', dir=run))
(profile/'user.js').write_text('user_pref("zen.welcome-screen.seen", true);\n')
browser = subprocess.Popen([sys.argv[2], '--no-remote', '--profile', str(profile), '--new-window', f'http://127.0.0.1:{server.server_port}'], stdout=sys.stderr)
def wait(predicate):
    end = time.monotonic()+25
    while time.monotonic()<end:
        if predicate(): return
        time.sleep(.1)
    raise AssertionError(dict(observed))
try:
    for field in ['normal', 'rich', 'password', 'plain']:
        state['focus'] = field
        wait(lambda: observed.get('focus') == field)
        time.sleep(.3)
        target = native.request('frontmost')
        result = native.request('focused-element')
        print(json.dumps({'field':field,'result':result}), flush=True)
        assert result['editable'] is (True if field in ['normal','rich'] else False if field=='password' else None), (field,result)
        decision = native.request('check-delivery', expected=target, intent='automatic', shortcut='ctrl-v')
        if field in ['normal','rich']:
            assert decision['kind']=='allowed',decision
            transaction = native.request('clipboard-save', purpose='paste', policy='leave', operationId=decision['operationId'])['transactionId']
            text = 'Žilina é 🚀'
            assert native.request('clipboard-write',text=text,transactionId=transaction)['written']
            assert native.request('paste',operationId=decision['operationId'],transactionId=transaction)['posted']
            wait(lambda: observed.get('text')==text)
        elif field=='password':
            assert decision['reason']=='protected-input',decision
            assert observed['text']==''
        else: assert decision['kind']=='copy',decision
    state['focus']='rich'
    wait(lambda: observed.get('focus')=='rich')
    time.sleep(.3)
    decision=native.request('check-delivery',expected=native.request('frontmost'),intent='automatic',shortcut='ctrl-v')
    assert decision['kind']=='allowed',decision
    transaction=native.request('clipboard-save',purpose='paste',policy='leave',operationId=decision['operationId'])['transactionId']
    assert native.request('clipboard-write',text='must not land',transactionId=transaction)['written']
    state['focus']='password'
    wait(lambda: observed.get('focus')=='password')
    time.sleep(.3)
    assert not native.request('paste',operationId=decision['operationId'],transactionId=transaction)['posted']
    assert observed['text']==''
    print('focus-change rejected; password unchanged',flush=True)
finally:
    browser.terminate();browser.wait(timeout=10)
    native.close();server.shutdown()
