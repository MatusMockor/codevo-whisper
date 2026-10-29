import importlib.util,pathlib,sys,time,os,hashlib
sys.dont_write_bytecode=True
source=pathlib.Path.cwd()/"native/linux-helper/test/desktop.py"
spec=importlib.util.spec_from_file_location("desktop",source);d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
helper=pathlib.Path(sys.argv[1]).resolve()
print({"helper":str(helper),"sha256":hashlib.sha256(helper.read_bytes()).hexdigest()},flush=True)
original=os.popen("xdotool getactivewindow").read().strip()
f=d.Client(["/usr/bin/python3",str(source),"--target",*(["--compatible-target"] if len(sys.argv)>2 and sys.argv[2]=="compatible-shift-v" else [])]);target=f.read();h=d.Client([str(helper)]);assert h.read()["event"]=="ready"
try:
 d.xdo("windowactivate","--sync",target["windowId"]);time.sleep(.4)
 current=h.request("frontmost")
 case=sys.argv[2] if len(sys.argv)>2 else "lease"
 def prepare(chord="ctrl-v",policy="restore"):
  op=h.request("check-delivery",expected=current,intent="automatic",shortcut=chord);assert op.get("kind")=="allowed",op
  saved=h.request("clipboard-save",purpose="paste",policy=policy,operationId=op["operationId"])
  return op,saved.get("transactionId","")
 def write(tx,text):return h.request("clipboard-write",text=text,transactionId=tx)
 def post(op,tx):return h.request("paste",operationId=op["operationId"],transactionId=tx)
 if case in ["lease","equal-lease"]:
  op,tx=prepare();assert write(tx,"intended transcript")["written"]
  f.request("copy",text="intended transcript" if case=="equal-lease" else "UNRELATED USER COPY");time.sleep(.15)
  posted=post(op,tx);time.sleep(.3);texts=f.request("text")["texts"]
  print({"posted":posted,"targetTexts":texts},flush=True)
  assert not posted["posted"] and texts[0]=="", "clipboard lease loss must refuse paste and preserve target"
 elif case=="copy-primary":
  op,tx=prepare("shift-insert","leave");assert write(tx,"first paste")["written"];assert post(op,tx)["posted"];time.sleep(.2)
  f.request("primary-copy",text="later user selection");time.sleep(.1)
  saved=h.request("clipboard-save",purpose="copy",policy="leave");assert write(saved.get("transactionId",""),"Copy Last")["written"]
  primary=f.request("primary")["text"];clipboard=f.request("clipboard")["text"]
  print({"primary":primary,"clipboard":clipboard},flush=True)
  assert primary=="later user selection" and clipboard=="Copy Last", "Copy Last must preserve PRIMARY after ShiftInsert"
 elif case=="compatible-shift-v":
  op,tx=prepare("ctrl-shift-v");assert write(tx,"Žilina CtrlShiftV 🚀")["written"];assert post(op,tx)["posted"];time.sleep(.2)
  actual=f.request("text")["texts"][0]
  print({"shortcut":"ctrl-shift-v","posted":True,"targetConsumed":actual=="Žilina CtrlShiftV 🚀","fixture":"GTK Entry with explicit CtrlShiftV paste binding"},flush=True)
  assert actual=="Žilina CtrlShiftV 🚀",actual
  h.request("clipboard-restore",transactionId=tx,expectedText=actual)
 elif case=="phases":
  for chord in ["ctrl-v","shift-insert"]:
   f.request("clear");f.request("focus",index=0);time.sleep(.15)
   op,tx=prepare(chord);assert write(tx,"Žilina 🚀")["written"]
   f.request("focus",index=1);time.sleep(.15)
   assert not post(op,tx)["posted"];assert f.request("text")["texts"]==["","",""]
   h.request("clipboard-restore",transactionId=tx,expectedText="Žilina 🚀",force=True)
   f.request("focus",index=0);time.sleep(.15)
   op,tx=prepare(chord);assert write(tx,"Žilina 🚀")["written"];assert post(op,tx)["posted"];time.sleep(.2)
   assert f.request("text")["texts"][0]=="Žilina 🚀"
   h.request("clipboard-restore",transactionId=tx,expectedText="Žilina 🚀")
   assert h.request("submit",operationId=op["operationId"],mode="enter")["posted"];time.sleep(.1)
   assert f.request("activations")["values"][-1]=="Žilina 🚀"
   assert not h.request("submit",operationId=op["operationId"],mode="enter")["posted"]
  f.request("clear");op,tx=prepare();assert write(tx,"pending")["written"]
  replacement=h.request("check-delivery",expected=current,intent="automatic",shortcut="ctrl-v");assert replacement["kind"]=="allowed"
  assert not post(op,tx)["posted"] and f.request("text")["texts"]==["","",""]
  h.request("clipboard-restore",transactionId=tx,expectedText="pending",force=True)
  print({"fieldRaceNoInjection":True,"positivePasteSubmit":True,"duplicateSubmitRefused":True,"replacementRefused":True},flush=True)
 elif case=="seat-loss":
  state=pathlib.Path(os.environ["CW_FIXTURE_SEAT_FILE"])
  try:
   for mode in ["inactive","locked","error"]:
    state.write_text("");time.sleep(.3);op,tx=prepare();assert write(tx,"never lost-seat text")["written"]
    state.write_text(mode)
    assert not post(op,tx)["posted"] and f.request("text")["texts"]==["","",""]
    assert h.request("clipboard-restore",transactionId=tx,expectedText="never lost-seat text",force=True)["restored"]
    print({"login1Fixture":mode,"posted":False,"targetEmpty":True},flush=True)
  finally:state.write_text("")
 elif case=="target-submit-races":
  op,tx=prepare();assert write(tx,"never unrelated")["written"]
  other=d.Client(["/usr/bin/python3",str(source),"--target"]);otherTarget=other.read()
  try:
   d.xdo("windowactivate","--sync",otherTarget["windowId"]);time.sleep(.15)
   assert not post(op,tx)["posted"]
   assert other.request("text")["texts"]==["","",""] and f.request("text")["texts"]==["","",""]
   h.request("clipboard-restore",transactionId=tx,expectedText="never unrelated",force=True)
  finally:other.close()
  d.xdo("windowactivate","--sync",target["windowId"]);f.request("focus",index=0);time.sleep(.15)
  op,tx=prepare();assert write(tx,"delivered")["written"];assert post(op,tx)["posted"];time.sleep(.15)
  f.request("focus",index=2);time.sleep(.15)
  assert not h.request("submit",operationId=op["operationId"],mode="enter")["posted"]
  assert f.request("activations")["values"]==[]
  assert f.request("text")["texts"]==["delivered","",""]
  h.request("clipboard-restore",transactionId=tx,expectedText="delivered",force=True)
  f.request("focus",index=0);f.request("clear");time.sleep(.15)
  op,tx=prepare();assert write(tx,"held refusal")["written"]
  d.xdo("keydown","Shift_L")
  try:assert not post(op,tx)["posted"] and f.request("text")["texts"]==["","",""]
  finally:d.xdo("keyup","Shift_L")
  h.request("clipboard-restore",transactionId=tx,expectedText="held refusal",force=True)
  print({"changedWindowNoInjection":True,"protectedSubmitRefused":True,"heldModifierRefused":True},flush=True)
 elif case=="stale-expired":
  op,tx=prepare();replacement=h.request("clipboard-save",purpose="paste",policy="restore",operationId=op["operationId"]);newtx=replacement["transactionId"]
  assert not write(tx,"stale")["written"] and write(newtx,"current")["written"]
  assert not post(op,tx)["posted"]
  time.sleep(5.1)
  assert not post(op,newtx)["posted"] and f.request("text")["texts"]==["","",""]
  assert h.request("clipboard-restore",transactionId=newtx,expectedText="current",force=True)["restored"]
  oldop=op["operationId"];h.close();h=d.Client([str(helper)]);assert h.read()["event"]=="ready"
  assert not h.request("paste",operationId=oldop,transactionId=newtx)["posted"]
  assert not h.request("clipboard-write",text="restart stale",transactionId=newtx)["written"]
  print({"staleTransactionRefused":True,"expiryRefused":True,"restartRefused":True},flush=True)
 elif case=="selection-leases":
  f.request("primary-copy",text="original PRIMARY");f.request("copy",text="original CLIPBOARD");time.sleep(.1)
  op,tx=prepare("shift-insert");assert write(tx,"same text")["written"];assert post(op,tx)["posted"];time.sleep(.2)
  f.request("primary-copy",text="same text");time.sleep(.1)
  assert h.request("clipboard-restore",transactionId=tx,expectedText="same text")["restored"]
  assert f.request("primary")["text"]=="same text" and f.request("clipboard")["text"]=="original CLIPBOARD"
  print({"PRIMARYLaterEqualTextPreserved":True,"CLIPBOARDRestoredIndependently":True},flush=True)
 elif case in ["incomplete","slow-snapshot"]:
  owner=d.Client(["/usr/bin/python3",str(source.with_name("selections.py")),"--owner"]);assert owner.read()["ready"]
  try:
   owner.request("own",text="irreplaceable original",reject=case=="incomplete",delay=1.5 if case=="slow-snapshot" else 0);time.sleep(.1)
   op=h.request("check-delivery",expected=current,intent="automatic",shortcut="ctrl-v");assert op.get("kind")=="allowed",op
   saved=h.request("clipboard-save",purpose="paste",policy="restore",operationId=op["operationId"])
   written=write(saved.get("transactionId",""),"must not replace");actual=owner.request("read")["text"]
   print({"prepared":saved,"written":written,"clipboard":actual},flush=True)
   assert not saved.get("saved",False) and not written["written"] and actual=="irreplaceable original", "incomplete paste preparation must preserve all original data"
   copied=h.request("clipboard-save",purpose="copy",policy="leave");assert write(copied["transactionId"],"explicit Copy")["written"]
   assert f.request("clipboard")["text"]=="explicit Copy", "explicit Copy must work despite non-restorable old formats"
  finally:owner.close()
 elif case in ["snapshot-owner","snapshot-equal-owner"]:
  f.request("copy",text="original");time.sleep(.1);op,tx=prepare()
  later="original" if case=="snapshot-equal-owner" else "later copy"
  f.request("copy",text=later);time.sleep(.1)
  written=write(tx,"must not replace");actual=f.request("clipboard")["text"]
  print({"written":written,"clipboard":actual},flush=True)
  assert not written["written"] and actual==later, "copy between snapshot and write must survive"
finally:
 h.close();f.close()
 if original:d.xdo("windowactivate",original)
