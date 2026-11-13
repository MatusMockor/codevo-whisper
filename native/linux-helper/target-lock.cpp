#include "internal.hpp"
#include <cerrno>
#include <csignal>
#include <algorithm>
#include <initializer_list>
#include <map>
namespace cw {
struct Range { int caret=-1; int start=-1; int end=-1; };
struct Capture {
  Target target; AtspiAccessible* element=nullptr; std::string identity; Range range;
  Target back; AtspiAccessible* backElement=nullptr; int64_t sequence=0;
};
static std::map<std::string,Capture> captures;
static int64_t sequence=0;
static constexpr size_t captureLimit=16;
static void release(AtspiAccessible*& element) { if(element)g_object_unref(element);element=nullptr; }
static Capture* find(const std::string& id) { auto it=captures.find(id);return it==captures.end()?nullptr:&it->second; }
static void erase(std::map<std::string,Capture>::iterator it) { release(it->second.element);release(it->second.backElement);captures.erase(it); }
struct XErrorTrap {
  XErrorTrap() { gdk_x11_display_error_trap_push(gdk_display_get_default()); }
  ~XErrorTrap() { gdk_x11_display_error_trap_pop_ignored(gdk_display_get_default()); }
};
template<class F> static bool until(F done) {
  for(auto end=g_get_monotonic_time()+1000000;;g_usleep(20000)) { if(done())return true;if(g_get_monotonic_time()>end)return false; }
}
static bool frontmostIs(const Target& t) { auto f=frontmost();return f.window==t.window && f.pid==t.pid; }
static bool has(AtspiAccessible* element,std::initializer_list<AtspiStateType> wanted) {
  atspi_accessible_clear_cache(element);
  auto states=atspi_accessible_get_state_set(element);
  bool ok=states && !atspi_state_set_contains(states,ATSPI_STATE_DEFUNCT);
  for(auto state:wanted)ok=ok && atspi_state_set_contains(states,state);
  if(states)g_object_unref(states);
  return ok;
}
static bool hasFocus(AtspiAccessible* element) { return has(element,{ATSPI_STATE_FOCUSED}); }
static bool alive(AtspiAccessible* element) {
  GError* error=nullptr;atspi_accessible_clear_cache(element);atspi_accessible_get_role(element,&error);
  if(error) {g_clear_error(&error);return false;}
  return has(element,{});
}
static bool activate(const Target& t) {
  XEvent e{};e.xclient.type=ClientMessage;e.xclient.window=t.window;e.xclient.format=32;
  e.xclient.message_type=XInternAtom(display,"_NET_ACTIVE_WINDOW",False);e.xclient.data.l[0]=2;e.xclient.data.l[1]=CurrentTime;
  XSendEvent(display,DefaultRootWindow(display),False,SubstructureRedirectMask|SubstructureNotifyMask,&e);XFlush(display);
  return until([&]{return frontmostIs(t);});
}
static bool grabFocus(AtspiAccessible* element) {
  auto component=atspi_accessible_get_component_iface(element);if(!component)return false;
  GError* error=nullptr;bool ok=atspi_component_grab_focus(component,&error);
  if(error) {g_printerr("target-lock: grab_focus failed: %s\n",error->message);g_clear_error(&error);ok=false;}
  g_object_unref(component);return ok;
}
static Range readRange(AtspiAccessible* element) {
  Range r;auto text=atspi_accessible_get_text_iface(element);if(!text)return r;
  GError* error=nullptr;r.caret=atspi_text_get_caret_offset(text,&error);if(error) {r.caret=-1;g_clear_error(&error);}
  if(atspi_text_get_n_selections(text,&error)>0 && !error) {
    auto range=atspi_text_get_selection(text,0,&error);
    if(range && !error && range->start_offset!=range->end_offset) {r.start=range->start_offset;r.end=range->end_offset;}
    g_free(range);
  }
  g_clear_error(&error);g_object_unref(text);return r;
}
static bool restoreRange(const Capture& c) {
  if(c.range.caret<0)return true;
  auto text=atspi_accessible_get_text_iface(c.element);if(!text)return false;
  GError* error=nullptr;
  if(c.range.start<0)atspi_text_set_caret_offset(text,c.range.caret,&error);
  else if(!atspi_text_set_selection(text,0,c.range.start,c.range.end,&error) && !error)atspi_text_add_selection(text,c.range.start,c.range.end,&error);
  if(error) {g_printerr("target-lock: caret restore failed: %s\n",error->message);g_clear_error(&error);}
  g_object_unref(text);
  auto now=readRange(c.element);
  return c.range.start>=0?now.start==c.range.start && now.end==c.range.end:now.start<0 && now.caret==c.range.caret;
}
std::string capturedIdentity(const std::string& id) { auto c=find(id);return c?c->identity:""; }
bool outsideCapture(JsonObject* args) {
  if(!args || !json_object_has_member(args,"captureId"))return false;
  auto c=find(string(args,"captureId"));if(!c || wayland || !display)return true;
  XErrorTrap trap;return !frontmostIs(c->target) || !hasFocus(c->element);
}
bool targetRelease(JsonObject* args) {
  auto it=captures.find(string(args,"captureId"));if(it==captures.end())return false;
  erase(it);return true;
}
JsonObject* targetCapture() {
  auto o=object();
  auto fail=[&](const char* reason) {boolean(o,"captured",false);text(o,"reason",reason);return o;};
  if(wayland || !display)return fail("unsupported");
  auto t=frontmost();if(!t.window || !t.pid)return fail("no-target");
  auto element=focusedAccessible(t);if(!element)return fail(accessibilityEnabled()?"no-element":"no-accessibility");
  Capture c;c.target=t;c.element=element;c.identity=describeField(element).identity;
  if(c.identity.empty()) {release(c.element);return fail("no-element");}
  c.range=readRange(element);
  if(captures.size()>=captureLimit)erase(std::min_element(captures.begin(),captures.end(),[](auto& a,auto& b){return a.second.sequence<b.second.sequence;}));
  gchar* raw=g_uuid_string_random();std::string id=raw;g_free(raw);c.sequence=++sequence;captures[id]=c;
  boolean(o,"captured",true);text(o,"captureId",id);describeTarget(o,t);return o;
}
JsonObject* targetRefocus(JsonObject* args) {
  auto o=object();
  auto fail=[&](const char* reason) {text(o,"result","failed");text(o,"reason",reason);return o;};
  auto found=find(string(args,"captureId"));if(!found)return fail("stale-capture");
  if(wayland || !display)return fail("unsupported");
  XErrorTrap trap;auto& c=*found;
  release(c.backElement);c.back=frontmost();c.backElement=focusedAccessible(c.back);
  auto verified=[&]{return hasFocus(c.element) && frontmostIs(c.target);};
  auto restored=[&](const char* result) {
    if(!restoreRange(c))return fail("caret-refused");
    if(!verified())return fail("focus-refused");
    text(o,"result",result);return o;
  };
  if(verified())return restored("in-place");
  if(kill(c.target.pid,0)!=0 && errno!=EPERM)return fail("app-gone");
  XWindowAttributes attributes;
  {XErrorTrap check;if(!XGetWindowAttributes(display,c.target.window,&attributes))return fail("window-gone");}
  if(!alive(c.element))return fail("element-gone");
  if(!has(c.element,{ATSPI_STATE_ENABLED,ATSPI_STATE_SENSITIVE}))return fail("focus-refused");
  awaitFocus(c.identity);
  if(!activate(c.target))return fail("activation-refused");
  grabFocus(c.element);
  if(!until(verified))return fail("focus-refused");
  settleFocus();
  return restored("moved");
}
JsonObject* targetReturn(JsonObject* args) {
  auto o=object();bool returned=false;
  auto c=find(string(args,"captureId"));
  if(c && c->back.window && display && !wayland) {
    XErrorTrap trap;activate(c->back);
    if(c->backElement && alive(c->backElement))grabFocus(c->backElement);
    returned=frontmostIs(c->back);
  }
  boolean(o,"returned",returned);return o;
}
}
