import json, os, pathlib, select, subprocess, sys, time
binary=str(pathlib.Path(sys.argv[1]).resolve())
env=os.environ.copy(); env.pop('DISPLAY',None); env.pop('WAYLAND_DISPLAY',None)
p=subprocess.Popen([binary],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
def read():
 assert select.select([p.stdout],[],[],3)[0], 'protocol timeout'
 return json.loads(p.stdout.readline())
assert read()['event']=='ready'
messages=[{'id':1,'cmd':'ping'},{'id':2,'cmd':'permissions'},{'id':3,'cmd':'check-delivery','args':{'expected':None,'intent':'automatic','shortcut':'ctrl-v'}},{'id':4,'cmd':'paste','args':{}},{'id':5,'cmd':'invalid'},{'id':6,'cmd':'listen-start','args':{'listenId':1,'kind':'key','keycode':3,'modifiers':['control']}},{'id':7,'cmd':'recording-audio-begin'}]
for msg in messages:
 wire=json.dumps(msg).encode()+b'\n'; p.stdin.write(wire[:7]);p.stdin.flush();p.stdin.write(wire[7:]);p.stdin.flush()
 results=[]
 while True:
  r=read()
  if 'id' in r: break
  results.append(r)
 assert r['id']==msg['id'] and r['cmd']==msg['cmd'], r
 if msg['id']==1: assert r['pong'] is True
 if msg['id']==2: assert not r['listenEvent'] and not r['postEvent'] and not r['accessibility'],r
 if msg['id']==3: assert r['kind']=='copy' and r['reason']=='unverified-target',r
 if msg['id']==4: assert r['posted'] is False,r
 if msg['id']==5: assert r['error']=='unknown-command',r
 if msg['id']==6: assert r['running'] is False,r
 if msg['id']==7: assert r['begun'] is False,r
p.stdin.write(b'{"id":8,"cmd":"clipboard-write","args":{"text":4}}\n');p.stdin.flush()
assert read()['written'] is False
p.stdin.close(); assert p.wait(timeout=3)==0
print('PASS native fragmented framing, IDs, unavailable permissions, fail-closed delivery, invalid commands and EOF')
