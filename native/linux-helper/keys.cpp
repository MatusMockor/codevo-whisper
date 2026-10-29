#include "internal.hpp"
#include <X11/XKBlib.h>
#include <X11/keysym.h>
#include <X11/extensions/XInput2.h>
#include <libevdev/libevdev.h>
#include <libudev.h>
#include <glib-unix.h>
#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <map>
#include <set>
#include <memory>
namespace cw {
static constexpr int X11_TAG=0x10000, EVDEV_TAG=0x20000;
static constexpr int64_t SHIFT=0x20000,CONTROL=0x40000,ALT=0x80000,META=0x100000;
struct Binding { std::string kind="none";std::set<int> keys;int key=0;int64_t flags=0; };
static Binding binding;
static std::set<int> held;
static std::set<int> recordedModifiers;
static int recordedKey=0;
static int64_t recordedFlags=0;
static int64_t listenId=0,recordingId=0;
static guint recordTimer=0,seatTimer=0;
static bool down=false,neutral=false,active=false,available=false;
static int64_t fencedUntil=0;
static int xiOpcode=0;
static Display* inputDisplay=nullptr;
static guint xWatch=0;
static unsigned int lockMask=LockMask,numMask=0;
static std::vector<std::pair<int,unsigned int>> grabs;
struct Device { int fd=-1;libevdev* ev=nullptr;guint watch=0;std::set<int> pressed;~Device(){if(watch)g_source_remove(watch);if(ev)libevdev_free(ev);if(fd>=0)close(fd);} };
static std::map<std::string,std::unique_ptr<Device>> devices;
static udev* udevContext=nullptr;
static udev_monitor* monitor=nullptr;
static guint monitorWatch=0;
static int64_t modifier(int key) {
  if(wayland) {
    switch(key) {case KEY_LEFTSHIFT:case KEY_RIGHTSHIFT:return SHIFT;case KEY_LEFTCTRL:case KEY_RIGHTCTRL:return CONTROL;case KEY_LEFTALT:case KEY_RIGHTALT:return ALT;case KEY_LEFTMETA:case KEY_RIGHTMETA:return META;default:return 0;}
  }
  auto sym=XkbKeycodeToKeysym(inputDisplay,key,0,0);
  switch(sym) {case XK_Shift_L:case XK_Shift_R:return SHIFT;case XK_Control_L:case XK_Control_R:return CONTROL;case XK_Alt_L:case XK_Alt_R:return ALT;case XK_Super_L:case XK_Super_R:case XK_Meta_L:case XK_Meta_R:return META;default:return 0;}
}
static int64_t flags(const std::set<int>& keys) {int64_t result=0;for(auto key:keys)result|=modifier(key);return result;}
static int tag() {return wayland?EVDEV_TAG:X11_TAG;}
static void edge(const char* phase) {auto o=object();text(o,"event","hotkey");text(o,"phase",phase);number(o,"listenId",listenId);number(o,"ts",g_get_real_time()/1000);emit(o);}
static void finishRecord(const char* name) {
  if(!recordingId)return;
  auto o=object();text(o,"event",name);number(o,"recordingId",recordingId);emit(o);recordingId=0;
  if(recordTimer){g_source_remove(recordTimer);recordTimer=0;}
}
void resetInput() {down=false;neutral=false;invalidateDelivery();event("tap-error");}
void fence(bool begin) {fencedUntil=begin?INT64_MAX:g_get_monotonic_time()+100000;}
static int replayKey() {return wayland?KEY_V:(inputDisplay?XKeysymToKeycode(inputDisplay,XK_v):0);}
static std::string keyLabel(int key) {
  if(wayland) {auto name=libevdev_event_code_get_name(EV_KEY,key);return name?name:"Key";}
  auto name=XKeysymToString(XkbKeycodeToKeysym(inputDisplay,key,0,0));return name?name:"Key";
}
static void completeRecording() {
  if(!recordingId)return;
  auto o=object();text(o,"event","recorded");number(o,"recordingId",recordingId);
  std::string label;
  if(recordedKey) {
    text(o,"kind","key");number(o,"keycode",tag()+recordedKey);auto list=json_array_new();
    for(auto pair:{std::pair<int64_t,const char*>(CONTROL,"control"),{ALT,"alt"},{SHIFT,"shift"},{META,"meta"}})if(recordedFlags&pair.first){json_array_add_string_element(list,pair.second);label+=std::string(pair.second)+"+";}
    json_object_set_array_member(o,"modifiers",list);label+=keyLabel(recordedKey);
  } else {
    text(o,"kind","modifiers");auto list=json_array_new();for(auto key:recordedModifiers){json_array_add_int_element(list,tag()+key);if(!label.empty())label+="+";label+=keyLabel(key);}json_object_set_array_member(o,"keycodes",list);
  }
  text(o,"label",label);emit(o);recordingId=0;if(recordTimer){g_source_remove(recordTimer);recordTimer=0;}neutral=false;
}
static void handle(int key,bool pressed,bool raw,int64_t observedFlags=-1) {
  if(raw && pressed && held.count(key) && !wayland)return;
  if(pressed)held.insert(key);else held.erase(key);
  if(!active || g_get_monotonic_time()<fencedUntil) {neutral=false;return;}
  if(!neutral) {if(held.empty()){neutral=true;event("tap-reenabled");}return;}
  auto current=observedFlags<0?flags(held):observedFlags;
  if(recordingId && raw) {
    if(pressed) {
      if(modifier(key))recordedModifiers.insert(key);
      else if(current) {recordedKey=key;recordedFlags=current;}
      else {finishRecord("record-unsupported");return;}
    } else if((recordedKey && key==recordedKey) || (!recordedKey && held.empty() && !recordedModifiers.empty())) {
      if(recordedKey==replayKey() && recordedFlags==(CONTROL|META))finishRecord("record-unsupported");else completeRecording();
    }
    return;
  }
  if(!raw && key==replayKey() && current==(CONTROL|META) && pressed) {auto o=object();text(o,"event","shortcut");text(o,"name","paste-last");emit(o);return;}
  if(binding.kind=="modifiers" && raw) {
    bool match=!binding.keys.empty() && held==binding.keys;
    if(match && !down) {down=true;edge("down");}
    else if(!match && down) {down=false;edge("up");}
  } else if(binding.kind=="key" && !raw && key==binding.key) {
    if(pressed && !down && current==binding.flags) {down=true;edge("down");}
    else if(!pressed && down) {down=false;edge("up");}
  }
}
int64_t modifierFlags() {
  if(inputDisplay && !wayland) {char keys[32];XQueryKeymap(inputDisplay,keys);std::set<int> current;for(int key=8;key<256;++key)if(keys[key/8]&(1<<(key%8)))current.insert(key);return flags(current);}
  int64_t result=0;for(auto& pair:devices)result|=flags(pair.second->pressed);return result;
}
static void ungrab() {if(inputDisplay)for(auto [key,mask]:grabs)XUngrabKey(inputDisplay,key,mask,DefaultRootWindow(inputDisplay));grabs.clear();}
static bool grab(int key,unsigned int mask) {
  static bool failed=false;failed=false;
  auto previous=XSetErrorHandler(+[](Display*,XErrorEvent* error)->int {if(error->error_code==BadAccess)failed=true;return 0;});
  for(auto extra:std::set<unsigned int>{0,lockMask,numMask,lockMask|numMask}) {XGrabKey(inputDisplay,key,mask|extra,DefaultRootWindow(inputDisplay),False,GrabModeAsync,GrabModeAsync);grabs.push_back({key,mask|extra});}
  XSync(inputDisplay,False);XSetErrorHandler(previous);return !failed;
}
static unsigned int xflags(int64_t flags) {unsigned int mask=0;if(flags&CONTROL)mask|=ControlMask;if(flags&ALT)mask|=Mod1Mask;if(flags&SHIFT)mask|=ShiftMask;if(flags&META)mask|=Mod4Mask;return mask;}
bool canListen() {return available && seatActive();}
JsonObject* listen(JsonObject* args) {
  finishRecord("record-cancelled");ungrab();binding={};down=false;neutral=held.empty();listenId=integer(args,"listenId");invalidateDelivery();
  auto o=object();auto kind=string(args,"kind");Binding next;next.kind=kind;
  auto invalid=[&](const char* reason){boolean(o,"running",false);text(o,"reason",reason);return o;};
  if(kind!="none" && kind!="key" && kind!="modifiers")return invalid("invalid-binding");
  if(kind!="none" && (listenId<=0 || !canListen()))return invalid("input-unavailable");
  if(kind=="key") {
    auto code=integer(args,"keycode")-tag();auto mods=array(args,"modifiers");
    if(code<=0 || code>(wayland?KEY_MAX:255) || !mods || !json_array_get_length(mods))return invalid("re-record-for-session");
    next.key=code;
    for(guint i=0;i<json_array_get_length(mods);++i) {
      auto node=json_array_get_element(mods,i);if(json_node_get_value_type(node)!=G_TYPE_STRING)return invalid("invalid-modifier");
      std::string m=json_node_get_string(node);if(m=="control")next.flags|=CONTROL;else if(m=="alt")next.flags|=ALT;else if(m=="shift")next.flags|=SHIFT;else if(m=="meta")next.flags|=META;else return invalid("unsupported-modifier");
    }
    if(next.key==replayKey() && next.flags==(CONTROL|META))return invalid("reserved-shortcut");
  } else if(kind=="modifiers") {
    auto keys=array(args,"keycodes");if(!keys || !json_array_get_length(keys) || json_array_get_length(keys)>8)return invalid("invalid-binding");
    for(guint i=0;i<json_array_get_length(keys);++i) {auto node=json_array_get_element(keys,i);if(json_node_get_value_type(node)!=G_TYPE_INT64)return invalid("invalid-keycode");auto code=json_node_get_int(node)-tag();if(code<=0 || code>(wayland?KEY_MAX:255) || !modifier(code))return invalid("re-record-for-session");next.keys.insert(code);}
  }
  if(inputDisplay && !wayland && canListen()) {
    if(!grab(replayKey(),ControlMask|Mod4Mask) || (kind=="key" && !grab(next.key,xflags(next.flags)))) {ungrab();return invalid("shortcut-in-use");}
  }
  binding=next;boolean(o,"running",kind=="none" || canListen());return o;
}
JsonObject* record(JsonObject* args) {
  finishRecord("record-cancelled");auto o=object();auto id=integer(args,"recordingId");auto timeout=integer(args,"timeoutMs",10000);
  if(id<=0 || timeout<0 || timeout>60000 || !canListen()) {boolean(o,"recording",false);text(o,"reason","input-unavailable");return o;}
  recordedModifiers.clear();recordedKey=0;recordedFlags=0;recordingId=id;neutral=held.empty();
  recordTimer=g_timeout_add(timeout,+[](gpointer)->gboolean {recordTimer=0;finishRecord("record-timeout");return G_SOURCE_REMOVE;},nullptr);
  boolean(o,"recording",true);return o;
}
static GdkFilterReturn filter(GdkXEvent* raw,GdkEvent*,gpointer) {
  auto event=static_cast<XEvent*>(raw);
  if(event->type==GenericEvent && event->xcookie.extension==xiOpcode) {
    bool acquired=false;if(!event->xcookie.data)acquired=XGetEventData(inputDisplay,&event->xcookie);
    if(event->xcookie.data && (event->xcookie.evtype==XI_RawKeyPress || event->xcookie.evtype==XI_RawKeyRelease)) {
      auto key=static_cast<XIRawEvent*>(event->xcookie.data);handle(key->detail,event->xcookie.evtype==XI_RawKeyPress,true);
    }
    if(acquired)XFreeEventData(inputDisplay,&event->xcookie);
  }
  if(event->type==KeyPress || event->type==KeyRelease) {
    auto& key=event->xkey;
    if(key.root==DefaultRootWindow(inputDisplay)) {
      if(event->type==KeyRelease && XPending(inputDisplay)) {XEvent next;XPeekEvent(inputDisplay,&next);if(next.type==KeyPress && next.xkey.keycode==key.keycode && next.xkey.time==key.time)return GDK_FILTER_REMOVE;}
      held.clear();char bitmap[32];XQueryKeymap(inputDisplay,bitmap);for(int k=8;k<256;++k)if(bitmap[k/8]&(1<<(k%8)))held.insert(k);
      int64_t state=0;if(key.state&ControlMask)state|=CONTROL;if(key.state&ShiftMask)state|=SHIFT;if(key.state&Mod1Mask)state|=ALT;if(key.state&Mod4Mask)state|=META;
      handle(key.keycode,event->type==KeyPress,false,state);return GDK_FILTER_REMOVE;
    }
  }
  return GDK_FILTER_CONTINUE;
}
static void refreshHeld() {held.clear();for(auto& pair:devices)held.insert(pair.second->pressed.begin(),pair.second->pressed.end());}
static void discover() {
  auto enumeration=udev_enumerate_new(udevContext);udev_enumerate_add_match_subsystem(enumeration,"input");udev_enumerate_add_match_property(enumeration,"ID_INPUT_KEYBOARD","1");udev_enumerate_scan_devices(enumeration);
  udev_list_entry* entry;
  udev_list_entry_foreach(entry,udev_enumerate_get_list_entry(enumeration)) {
    auto node=udev_device_new_from_syspath(udevContext,udev_list_entry_get_name(entry));auto path=udev_device_get_devnode(node);auto seat=udev_device_get_property_value(node,"ID_SEAT");
    if(path && (!seat || std::string(seat)==(g_getenv("XDG_SEAT")?g_getenv("XDG_SEAT"):"seat0")) && !devices.count(path)) {
      auto d=std::make_unique<Device>();d->fd=open(path,O_RDONLY|O_NONBLOCK|O_CLOEXEC);
      if(d->fd>=0 && libevdev_new_from_fd(d->fd,&d->ev)==0) {
        for(int k=0;k<=KEY_MAX;++k)if(libevdev_get_event_value(d->ev,EV_KEY,k))d->pressed.insert(k);
        d->watch=g_unix_fd_add(d->fd,GIOCondition(G_IO_IN|G_IO_HUP|G_IO_ERR),+[](gint,GIOCondition condition,gpointer data)->gboolean {
          auto d=static_cast<Device*>(data);
          if(condition&(G_IO_HUP|G_IO_ERR)) {d->watch=0;d->pressed.clear();resetInput();refreshHeld();return G_SOURCE_REMOVE;}
          input_event ev;int status;
          while((status=libevdev_next_event(d->ev,LIBEVDEV_READ_FLAG_NORMAL,&ev))>=0) {
            if(status==LIBEVDEV_READ_STATUS_SYNC) {
              resetInput();while(libevdev_next_event(d->ev,LIBEVDEV_READ_FLAG_SYNC,&ev)>=0) {}
              d->pressed.clear();for(int k=0;k<=KEY_MAX;++k)if(libevdev_get_event_value(d->ev,EV_KEY,k))d->pressed.insert(k);refreshHeld();continue;
            }
            if(ev.type!=EV_KEY || ev.value==2)continue;
            if(ev.value)d->pressed.insert(ev.code);else d->pressed.erase(ev.code);
            refreshHeld();handle(ev.code,held.count(ev.code),true);
            if(binding.kind=="key" || ev.code==replayKey())handle(ev.code,held.count(ev.code),false);
          }
          if(status!=-EAGAIN) {d->watch=0;resetInput();return G_SOURCE_REMOVE;}
          return G_SOURCE_CONTINUE;
        },d.get());devices.emplace(path,std::move(d));
      }
    }
    udev_device_unref(node);
  }
  udev_enumerate_unref(enumeration);refreshHeld();available=!devices.empty();neutral=held.empty();
}
void keysInit() {
  active=seatActive();
  if(!wayland)inputDisplay=XOpenDisplay(nullptr);
  if(inputDisplay && !wayland) {
    int event,error;available=XQueryExtension(inputDisplay,"XInputExtension",&xiOpcode,&event,&error);int major=2,minor=0;
    if(available)available=XIQueryVersion(inputDisplay,&major,&minor)==Success;
    if(available) {unsigned char bits[XIMaskLen(XI_LASTEVENT)]={};XISetMask(bits,XI_RawKeyPress);XISetMask(bits,XI_RawKeyRelease);XIEventMask mask{XIAllMasterDevices,sizeof(bits),bits};XISelectEvents(inputDisplay,DefaultRootWindow(inputDisplay),&mask,1);XSelectInput(inputDisplay,DefaultRootWindow(inputDisplay),KeyPressMask|KeyReleaseMask);xWatch=g_unix_fd_add(ConnectionNumber(inputDisplay),G_IO_IN,+[](gint,GIOCondition,gpointer)->gboolean {while(XPending(inputDisplay)){XEvent ev;XNextEvent(inputDisplay,&ev);filter(&ev,nullptr,nullptr);}return G_SOURCE_CONTINUE;},nullptr);XFlush(inputDisplay);}
    auto mods=XGetModifierMapping(inputDisplay);if(mods){auto num=XKeysymToKeycode(inputDisplay,XK_Num_Lock);for(int m=0;m<8;++m)for(int k=0;k<mods->max_keypermod;++k)if(mods->modifiermap[m*mods->max_keypermod+k]==num)numMask|=1u<<m;XFreeModifiermap(mods);}
    char bitmap[32];XQueryKeymap(inputDisplay,bitmap);for(int k=8;k<256;++k)if(bitmap[k/8]&(1<<(k%8)))held.insert(k);
  } else if(wayland) {
    udevContext=udev_new();if(udevContext) {discover();monitor=udev_monitor_new_from_netlink(udevContext,"udev");udev_monitor_filter_add_match_subsystem_devtype(monitor,"input",nullptr);udev_monitor_enable_receiving(monitor);
      monitorWatch=g_unix_fd_add(udev_monitor_get_fd(monitor),G_IO_IN,+[](gint,GIOCondition,gpointer)->gboolean {
        auto device=udev_monitor_receive_device(monitor);if(device) {auto path=udev_device_get_devnode(device);auto action=udev_device_get_action(device);if(path && action && std::string(action)=="remove"){devices.erase(path);resetInput();}udev_device_unref(device);}discover();return G_SOURCE_CONTINUE;
      },nullptr);
    }
  }
  neutral=held.empty();
  seatTimer=g_timeout_add(250,+[](gpointer)->gboolean {
    bool next=seatActive();if(next!=active){active=next;resetInput();if(next && held.empty()){neutral=true;event("tap-reenabled");}}if(active && !neutral && held.empty() && g_get_monotonic_time()>fencedUntil){neutral=true;event("tap-reenabled");}return G_SOURCE_CONTINUE;
  },nullptr);
}
void keysShutdown() {
  if(recordTimer)g_source_remove(recordTimer);
  if(seatTimer)g_source_remove(seatTimer);
  if(monitorWatch)g_source_remove(monitorWatch);
  if(xWatch)g_source_remove(xWatch);
  if(inputDisplay && !wayland){ungrab();XCloseDisplay(inputDisplay);inputDisplay=nullptr;}devices.clear();if(monitor)udev_monitor_unref(monitor);if(udevContext)udev_unref(udevContext);
}
}
