import json, os, pathlib, select, subprocess, sys, tempfile
helper=str(pathlib.Path(sys.argv[1]).resolve()); fixture=str(pathlib.Path(sys.argv[2]).resolve())
assert os.environ.get('DISPLAY'), 'run under xvfb-run'
state=pathlib.Path(tempfile.mkdtemp())/'seat'; state.write_text('')
env=os.environ.copy(); env.pop('WAYLAND_DISPLAY',None); env['XDG_SESSION_TYPE']='x11'; env['LD_PRELOAD']=fixture; env['CW_FIXTURE_SEAT_FILE']=str(state)
p=subprocess.Popen([helper],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
def read():
 assert select.select([p.stdout],[],[],3)[0], 'protocol timeout'
 return json.loads(p.stdout.readline())
def request(id,cmd):
 p.stdin.write(json.dumps({'id':id,'cmd':cmd}).encode()+b'\n'); p.stdin.flush()
 while True:
  r=read()
  if r.get('id')==id: return r
try:
 assert read()['event']=='ready'
 cases=[('unlocked',True),('stale-locked',True),('locked',False),('locked-unknown',False),('inactive',False),('error',False)]
 for i,(mode,expected) in enumerate(cases,1):
  state.write_text(mode); r=request(i,'permissions')
  assert r['listenEvent'] is expected and r['postEvent'] is expected, (mode,r)
  print({'login1Fixture':mode,'listenEvent':r['listenEvent'],'postEvent':r['postEvent']},flush=True)
finally:
 p.kill()
