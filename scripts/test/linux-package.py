import argparse, hashlib, json, os, pathlib, re, shlex, shutil, struct, subprocess, tempfile

parser=argparse.ArgumentParser()
parser.add_argument('--artifact',type=pathlib.Path,required=True)
parser.add_argument('--cpu-without-vulkan',action='store_true')
parser.add_argument('--model',type=pathlib.Path)
parser.add_argument('--pcm',type=pathlib.Path)
args=parser.parse_args()
artifact=args.artifact.resolve();assert artifact.is_file(),artifact
runtime_env={k:v for k,v in os.environ.items() if k not in ['LD_LIBRARY_PATH','LD_PRELOAD','LIBRARY_PATH','VK_ICD_FILENAMES','VK_DRIVER_FILES']}

work=pathlib.Path(tempfile.mkdtemp(prefix='cw-package-'))
if artifact.suffix=='.deb':
 extract=work/'deb';subprocess.run(['dpkg-deb','-x',str(artifact),str(extract)],check=True)
else:
 assert artifact.name.endswith('.AppImage'),artifact
 subprocess.run([str(artifact),'--appimage-extract'],cwd=work,check=True,stdout=subprocess.DEVNULL)
 extract=work/'squashfs-root'
helpers=list(extract.glob('**/resources/bin/*/codevo-input-helper'));assert len(helpers)==1,helpers
binaries=helpers[0].parent
identities={}
for name in ['codevo-input-helper','transcribe-cli','cw-stt-worker','cw-stt-worker-vulkan']:
 p=binaries/name;assert p.is_file() and os.access(p,os.X_OK),p
 raw=p.read_bytes();assert raw[:4]==b'\x7fELF' and raw[4]==2 and raw[5]==1,p
 machine=struct.unpack_from('<H',raw,18)[0];assert machine in [62,183],(p,machine)
 dynamic=subprocess.check_output(['readelf','-d',str(p)],text=True)
 for search in re.findall(r'Library (?:runpath|rpath): \[(.*?)\]',dynamic):
  assert all(part.startswith('$ORIGIN') for part in search.split(':')),('nonrelocatable ELF search path',p,search)
 closure=subprocess.run(['ldd',str(p)],capture_output=True,text=True,env=runtime_env);assert closure.returncode==0 and 'not found' not in closure.stdout,(p,closure.stdout)
 identities[name]={'sha256':hashlib.sha256(raw).hexdigest(),'machine':machine,'needed':re.findall(r'Shared library: \[(.*?)\]',dynamic),'closure':closure.stdout}
assert 'libvulkan.so.1' not in identities['cw-stt-worker']['needed']
assert 'libvulkan.so.1' in identities['cw-stt-worker-vulkan']['needed']
subprocess.run([str(binaries/'transcribe-cli'),'--help'],cwd=work,check=True,capture_output=True,env=runtime_env)
print(json.dumps({'artifact':str(artifact),'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'work':str(work),'binaries':identities}),flush=True)
if args.cpu_without_vulkan:
 assert args.model and args.pcm,'--cpu-without-vulkan requires exact --model and --pcm'
 fixture=work/'root';fixture.mkdir()
 for name in ['cw-stt-worker','cw-stt-worker-vulkan']:
  dest=fixture/'bin'/name;dest.parent.mkdir(exist_ok=True);shutil.copyfile(binaries/name,dest);dest.chmod(0o755)
 for path in re.findall(r'(/[^\s()]+)',identities['cw-stt-worker']['closure']):
  source=pathlib.Path(path)
  if not source.is_file():continue
  dest=fixture/source.relative_to('/');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest);shutil.copymode(source,dest)
 assert not list(fixture.glob('**/*vulkan*so*')),'fixture must actually lack the Vulkan loader'
 (fixture/'model.gguf').touch();(fixture/'proc').mkdir();(fixture/'dev').mkdir()
 attempts=work/'attempts'
 wrappers={}
 for backend,name in [('cpu','cw-stt-worker'),('vulkan','cw-stt-worker-vulkan')]:
  wrapper=work/f'launch-{backend}'
  command=['bwrap','--unshare-user','--unshare-pid','--unshare-net','--die-with-parent','--ro-bind',str(fixture),'/','--ro-bind',str(args.model.resolve()),'/model.gguf','--proc','/proc','--dev','/dev',f'/bin/{name}']
  wrapper.write_text('#!/bin/sh\nprintf "%s\\n" '+shlex.quote(backend)+' >> '+shlex.quote(str(attempts))+'\nexec '+shlex.join(command)+' "$@"\n');wrapper.chmod(0o755);wrappers[backend]=wrapper
 root=pathlib.Path(__file__).resolve().parents[2]
 command=[str(root/'apps/desktop/node_modules/.bin/tsx'),str(root/'packages/stt-runner/test/worker-fallback.ts'),'--accelerator',str(wrappers['vulkan']),'--cpu',str(wrappers['cpu']),'--model','/model.gguf','--pcm',str(args.pcm.resolve())]
 subprocess.run(command,cwd=work,check=True,env=runtime_env)
 assert attempts.read_text().splitlines()==['cpu','vulkan','cpu'],attempts.read_text()
 print(json.dumps({'absentVulkan':True,'fixture':str(fixture),'attempts':attempts.read_text().splitlines(),'modelSha256':hashlib.file_digest(args.model.open('rb'),'sha256').hexdigest(),'pcmSha256':hashlib.sha256(args.pcm.read_bytes()).hexdigest()}),flush=True)
