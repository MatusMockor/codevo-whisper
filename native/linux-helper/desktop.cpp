#include "internal.hpp"
#include <atspi/atspi.h>
#include <X11/Xatom.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <optional>
#include <unistd.h>
namespace cw {
Display* display=nullptr;
bool wayland=false;
static int64_t generation=0;
static std::optional<Operation> operation;
static AtspiEventListener* focusListener=nullptr;
static GDBusConnection* systemBus=nullptr;
static std::string sessionPath;
static bool xtest=false;
bool usesPrimary() { return operation && operation->shortcut=="shift-insert"; }
void invalidateDelivery() { ++generation;operation.reset(); }
static GVariant* call(const char* path,const char* iface,const char* method,GVariant* args,const GVariantType* type) {
  if(!systemBus) return nullptr;
  GError* error=nullptr;
  auto result=g_dbus_connection_call_sync(systemBus,"org.freedesktop.login1",path,iface,method,args,type,G_DBUS_CALL_FLAGS_NONE,300,nullptr,&error);
  g_clear_error(&error);return result;
}
static void findSession() {
  auto env=g_getenv("XDG_SESSION_ID");
  auto result=env ? call("/org/freedesktop/login1","org.freedesktop.login1.Manager","GetSession",g_variant_new("(s)",env),G_VARIANT_TYPE("(o)")) : nullptr;
  if(result) { const char* path;g_variant_get(result,"(&o)",&path);sessionPath=path;g_variant_unref(result);return; }
  result=call("/org/freedesktop/login1","org.freedesktop.login1.Manager","GetUser",g_variant_new("(u)",getuid()),G_VARIANT_TYPE("(o)"));
  if(!result) return;
  const char* path;g_variant_get(result,"(&o)",&path);
  auto prop=call(path,"org.freedesktop.DBus.Properties","Get",g_variant_new("(ss)","org.freedesktop.login1.User","Display"),G_VARIANT_TYPE("(v)"));
  g_variant_unref(result);
  if(!prop)return;
  GVariant* boxed;g_variant_get(prop,"(v)",&boxed);const char* id;const char* session;
  if(g_variant_is_of_type(boxed,G_VARIANT_TYPE("(so)"))) {g_variant_get(boxed,"(&s&o)",&id,&session);sessionPath=session;}
  g_variant_unref(boxed);g_variant_unref(prop);
}
bool seatActive() {
  if(sessionPath.empty()) return false;
  auto result=call(sessionPath.c_str(),"org.freedesktop.DBus.Properties","GetAll",g_variant_new("(s)","org.freedesktop.login1.Session"),G_VARIANT_TYPE("(a{sv})"));
  if(!result)return false;
  GVariant* props;g_variant_get(result,"(@a{sv})",&props);gboolean active=false,locked=true;
  bool known=g_variant_lookup(props,"Active","b",&active) && g_variant_lookup(props,"LockedHint","b",&locked);
  g_variant_unref(props);g_variant_unref(result);return known && active && !locked;
}
void desktopInit() {
  wayland=std::string(g_getenv("XDG_SESSION_TYPE")?g_getenv("XDG_SESSION_TYPE"):"")=="wayland" || g_getenv("WAYLAND_DISPLAY");
  auto gdk=gdk_display_get_default();
  if(gdk && GDK_IS_X11_DISPLAY(gdk)) display=GDK_DISPLAY_XDISPLAY(gdk);
  GError* error=nullptr;systemBus=g_bus_get_sync(G_BUS_TYPE_SYSTEM,nullptr,&error);g_clear_error(&error);findSession();
  if(display) {int a,b,c,d;xtest=XTestQueryExtension(display,&a,&b,&c,&d);}
  if(atspi_init()==0) {
    atspi_set_timeout(200,200);
    focusListener=atspi_event_listener_new(+[](AtspiEvent*,void*) {invalidateDelivery();},nullptr,nullptr);
    atspi_event_listener_register(focusListener,"object:state-changed:focused",nullptr);
    atspi_event_listener_register(focusListener,"window:activate",nullptr);
  }
}
static unsigned long property(Window w, const char* key, Atom type) {
  Atom actual;int format;unsigned long count,left;unsigned char* bytes=nullptr;unsigned long value=0;
  if(XGetWindowProperty(display,w,XInternAtom(display,key,False),0,1,False,type,&actual,&format,&count,&left,&bytes)==Success && actual==type && format==32 && count==1) value=*reinterpret_cast<unsigned long*>(bytes);
  if(bytes)XFree(bytes);
  return value;
}
Target frontmost() {
  Target t;if(!display || wayland)return t;
  t.window=property(DefaultRootWindow(display),"_NET_ACTIVE_WINDOW",XA_WINDOW);
  if(!t.window)return {};
  t.pid=property(t.window,"_NET_WM_PID",XA_CARDINAL);
  if(t.pid<=0)return {};
  XClassHint hint{};if(XGetClassHint(display,t.window,&hint)) {if(hint.res_class)t.name=hint.res_class;if(hint.res_class)XFree(hint.res_class);if(hint.res_name)XFree(hint.res_name);}
  return t;
}
void describeTarget(JsonObject* o,const Target& t) {
  if(!t.window || !t.pid) {json_object_set_null_member(o,"pid");json_object_set_null_member(o,"windowId");return;}
  number(o,"pid",t.pid);number(o,"windowId",t.window);text(o,"bundleId",t.name);text(o,"name",t.name);
}
static AtspiAccessible* findFocus(AtspiAccessible* node,int depth,int& budget,int64_t deadline) {
  if(!node || depth>32 || --budget<0 || g_get_monotonic_time()>deadline)return nullptr;
  atspi_accessible_clear_cache(node);
  auto states=atspi_accessible_get_state_set(node);
  bool focus=states && atspi_state_set_contains(states,ATSPI_STATE_FOCUSED) && !atspi_state_set_contains(states,ATSPI_STATE_DEFUNCT);
  if(states)g_object_unref(states);
  if(focus)return ATSPI_ACCESSIBLE(g_object_ref(node));
  GError* error=nullptr;int count=atspi_accessible_get_child_count(node,&error);if(error){g_clear_error(&error);return nullptr;}
  for(int i=0;i<count && budget>0;++i) {
    auto child=atspi_accessible_get_child_at_index(node,i,&error);if(error){g_clear_error(&error);continue;}
    auto found=findFocus(child,depth+1,budget,deadline);if(child)g_object_unref(child);if(found)return found;
  }
  return nullptr;
}
Field focused(const Target& target) {
  Field field;if(!target.pid || wayland || !focusListener)return field;
  auto desktop=atspi_get_desktop(0);if(!desktop)return field;
  GError* error=nullptr;int count=atspi_accessible_get_child_count(desktop,&error);g_clear_error(&error);
  AtspiAccessible* focus=nullptr;auto deadline=g_get_monotonic_time()+1200000;
  for(int i=0;i<count && i<256 && !focus && g_get_monotonic_time()<deadline;++i) {
    auto app=atspi_accessible_get_child_at_index(desktop,i,&error);if(error){g_clear_error(&error);continue;}
    if(app && atspi_accessible_get_process_id(app,&error)==static_cast<guint>(target.pid)) {int budget=2048;focus=findFocus(app,0,budget,deadline);}
    g_clear_error(&error);if(app)g_object_unref(app);
  }
  g_object_unref(desktop);if(!focus)return field;
  auto role=atspi_accessible_get_role(focus,&error);if(error){g_clear_error(&error);g_object_unref(focus);return field;}
  field.protectedInput=role==ATSPI_ROLE_PASSWORD_TEXT;
  bool textRole=role==ATSPI_ROLE_TEXT || role==ATSPI_ROLE_ENTRY || role==ATSPI_ROLE_PASSWORD_TEXT;
  auto states=atspi_accessible_get_state_set(focus);
  field.known=textRole && states && atspi_state_set_contains(states,ATSPI_STATE_ENABLED) && atspi_state_set_contains(states,ATSPI_STATE_SENSITIVE);
  field.editable=states && atspi_state_set_contains(states,ATSPI_STATE_EDITABLE);
  auto obj=ATSPI_OBJECT(focus);if(obj->path && obj->app && obj->app->bus_name)field.identity=std::string(obj->app->bus_name)+":"+obj->path;
  auto name=atspi_role_get_name(role);if(name)field.role=name;g_free(name);
  if(states)g_object_unref(states);
  g_object_unref(focus);
  return field;
}
JsonObject* checkDelivery(JsonObject* args) {
  operation.reset();auto o=object();auto t=frontmost();auto intent=string(args,"intent");auto shortcut=string(args,"shortcut");
  auto outcome=[&](const char* kind,const char* reason) {text(o,"kind",kind);text(o,"reason",reason);return o;};
  if((intent!="automatic" && intent!="replay") || (shortcut!="ctrl-v" && shortcut!="ctrl-shift-v" && shortcut!="shift-insert")) return outcome("copy","unverified-target");
  auto expected=child(args,"expected");
  if(!t.window || !t.pid || (intent=="automatic" && (!expected || integer(expected,"windowId")<=0 || integer(expected,"pid")<=0))) return outcome("copy","unverified-target");
  if(intent=="automatic" && (integer(expected,"windowId")!=static_cast<int64_t>(t.window) || integer(expected,"pid")!=t.pid)) return outcome("blocked","focus-changed");
  auto f=focused(t);
  if(f.protectedInput)return outcome("blocked","protected-input");
  if(!f.known || !f.editable || f.identity.empty())return outcome("copy","unverified-target");
  if(modifierFlags()!=0)return outcome("blocked","modifiers-held");
  if(!xtest || !seatActive())return outcome("copy","posting-unavailable");
  gchar* id=g_uuid_string_random();Operation op;op.id=id;g_free(id);op.target=t;op.field=f;op.generation=generation;op.shortcut=shortcut;op.expires=g_get_monotonic_time()+5000000;operation=op;
  text(o,"kind","allowed");text(o,"operationId",op.id);describeTarget(o,t);return o;
}
bool post(JsonObject* args,bool submit) {
  if(!operation || string(args,"operationId")!=operation->id || !display || wayland)return false;
  auto op=*operation;
  if(!submit && !selectionRestorable())return false;
  if(g_get_monotonic_time()>op.expires || generation!=op.generation || op.pasted!=submit || !seatActive() || modifierFlags()!=0) {operation.reset();return false;}
  auto target=frontmost();auto field=focused(target);
  if(target.window!=op.target.window || target.pid!=op.target.pid || !field.known || !field.editable || field.protectedInput || field.identity!=op.field.identity || generation!=op.generation) {operation.reset();return false;}
  KeySym key=XK_v;std::vector<KeySym> modifiers;
  if(submit) {
    auto mode=string(args,"mode");if(mode!="enter" && mode!="primary-enter")return false;
    key=XK_Return;if(mode=="primary-enter")modifiers.push_back(XK_Control_L);
  } else if(op.shortcut=="shift-insert") { key=XK_Insert;modifiers.push_back(XK_Shift_L); }
  else {modifiers.push_back(XK_Control_L);if(op.shortcut=="ctrl-shift-v")modifiers.push_back(XK_Shift_L);}
  auto keycode=XKeysymToKeycode(display,key);if(!keycode)return false;
  for(auto modifier:modifiers)if(!XKeysymToKeycode(display,modifier))return false;
  fence(true);
  for(auto modifier:modifiers)XTestFakeKeyEvent(display,XKeysymToKeycode(display,modifier),True,CurrentTime);
  XTestFakeKeyEvent(display,keycode,True,CurrentTime);XTestFakeKeyEvent(display,keycode,False,CurrentTime);
  for(auto it=modifiers.rbegin();it!=modifiers.rend();++it)XTestFakeKeyEvent(display,XKeysymToKeycode(display,*it),False,CurrentTime);
  XSync(display,False);fence(false);
  if(operation) {if(submit)operation.reset();else operation->pasted=true;}
  return true;
}
void shutdownDesktop() {
  if(focusListener) {atspi_event_listener_deregister(focusListener,"object:state-changed:focused",nullptr);atspi_event_listener_deregister(focusListener,"window:activate",nullptr);g_object_unref(focusListener);}
  atspi_exit();if(systemBus)g_object_unref(systemBus);
}
}
