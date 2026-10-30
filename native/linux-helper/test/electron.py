import json, os, pathlib, subprocess, sys, time
sys.dont_write_bytecode = True
from desktop import Client

assert os.environ.get('GSETTINGS_BACKEND') == 'memory', 'requires isolated accessibility preferences'

helper = pathlib.Path(sys.argv[1]).resolve()
electron = pathlib.Path(sys.argv[2]).resolve()
fixture = pathlib.Path(__file__).with_name('electron-target.js').resolve()
os.environ.pop('ELECTRON_RUN_AS_NODE', None)
target = Client([str(electron), str(fixture)])
native = None
try:
    ready = target.read(timeout=20)
    assert ready['ready']
    native = Client([str(helper)])
    assert native.read()['event'] == 'ready'
    def status(method, prop, *args):
        return subprocess.check_output(['gdbus', 'call', '--session', '--dest', 'org.a11y.Bus', '--object-path', '/org/a11y/bus', '--method', 'org.freedesktop.DBus.Properties.' + method, 'org.a11y.Status', prop, *args], text=True)
    status('Set', 'IsEnabled', '<false>')
    screen_reader = status('Get', 'ScreenReaderEnabled')
    assert native.request('permissions')['accessibility'] is False
    assert native.request('request-permission', kind='accessibility')['accessibility'] is True
    assert 'true' in status('Get', 'IsEnabled')
    assert status('Get', 'ScreenReaderEnabled') == screen_reader
    frontmost = native.request('frontmost')
    assert frontmost.get('pid') == ready['pid'], frontmost
    for field in ['normal', 'rich', 'password']:
        target.p.stdin.write((json.dumps({'cmd': 'focus', 'field': field}) + '\n').encode())
        assert target.read()['focused'] == field
        deadline = time.monotonic() + 3
        result = None
        while time.monotonic() < deadline:
            result = native.request('focused-element')
            if result.get('editable') is (field != 'password'):
                break
            time.sleep(.1)
        assert result.get('editable') is (field != 'password'), (field, result)
        if field == 'password':
            decision = native.request('check-delivery', expected=None, intent='replay', shortcut='ctrl-v')
            assert decision['kind'] == 'blocked' and decision['reason'] == 'protected-input', decision
        else:
            decision = native.request('check-delivery', expected=frontmost, intent='automatic', shortcut='ctrl-v')
            assert decision['kind'] == 'allowed', decision
            saved = native.request('clipboard-save', purpose='paste', policy='leave', operationId=decision['operationId'])
            transaction = saved['transactionId']
            transcript = 'Žilina é 🚀'
            assert native.request('clipboard-write', text=transcript, transactionId=transaction)['written']
            assert native.request('paste', operationId=decision['operationId'], transactionId=transaction)['posted']
            time.sleep(.2)
            target.p.stdin.write((json.dumps({'cmd': 'text', 'field': field}) + '\n').encode())
            assert target.read()['text'] == transcript
        print(json.dumps({'field': field, 'result': result}), flush=True)
    target.p.stdin.write((json.dumps({'cmd': 'focus', 'field': 'normal'}) + '\n').encode())
    assert target.read()['focused'] == 'normal'
    time.sleep(.2)
    decision = native.request('check-delivery', expected=frontmost, intent='automatic', shortcut='ctrl-v')
    assert decision['kind'] == 'allowed', decision
    saved = native.request('clipboard-save', purpose='paste', policy='leave', operationId=decision['operationId'])
    assert native.request('clipboard-write', text='must not land', transactionId=saved['transactionId'])['written']
    target.p.stdin.write((json.dumps({'cmd': 'focus', 'field': 'password'}) + '\n').encode())
    assert target.read()['focused'] == 'password'
    time.sleep(.2)
    assert not native.request('paste', operationId=decision['operationId'], transactionId=saved['transactionId'])['posted']
    target.p.stdin.write((json.dumps({'cmd': 'text', 'field': 'password'}) + '\n').encode())
    assert target.read()['text'] == ''
    print('focus-change rejected; password unchanged', flush=True)
finally:
    if native:
        native.close()
    target.close()
