#pragma once
#include <gtk/gtk.h>
#include <gdk/gdkx.h>
#include <atspi/atspi.h>
#include <json-glib/json-glib.h>
#include <X11/Xlib.h>
#include <cstdint>
#include <string>
#include <vector>

namespace cw {
JsonObject* object();
void text(JsonObject*, const char*, const std::string&);
void boolean(JsonObject*, const char*, bool);
void number(JsonObject*, const char*, int64_t);
std::string string(JsonObject*, const char*);
int64_t integer(JsonObject*, const char*, int64_t fallback = 0);
bool truth(JsonObject*, const char*);
JsonObject* child(JsonObject*, const char*);
JsonArray* array(JsonObject*, const char*);
void emit(JsonObject*);
void event(const char*);
struct Target { Window window = 0; long pid = 0; std::string name; };
struct Field { std::string identity; std::string role; bool known = false; bool editable = false; bool protectedInput = false; };
struct Operation { std::string id; Target target; Field field; std::string shortcut; int64_t generation = 0; int64_t expires = 0; bool pasted = false; };
extern Display* display;
extern bool wayland;
extern GMainLoop* loop;
void desktopInit();
bool accessibilityEnabled(bool request = false);
Target frontmost();
AtspiAccessible* focusedAccessible(const Target&);
Field describeField(AtspiAccessible*);
Field focused(const Target&);
std::string accessibleIdentity(AtspiAccessible*);
void awaitFocus(const std::string& identity);
void settleFocus();
bool seatActive();
void describeTarget(JsonObject*, const Target&);
JsonObject* checkDelivery(JsonObject*);
JsonObject* targetCapture();
JsonObject* targetRefocus(JsonObject*);
JsonObject* targetReturn(JsonObject*);
JsonObject* targetContext(JsonObject*);
bool targetRelease(JsonObject*);
std::string capturedIdentity(const std::string& captureId);
enum class Post { Posted, Refused, FocusChanged };
Post post(JsonObject*, bool submit);
bool outsideCapture(JsonObject*);
void invalidateDelivery();
std::string selectionShortcut(const std::string&);
void shutdownDesktop();
JsonObject* selectionSave(JsonObject*);
bool selectionWrite(JsonObject*);
bool selectionRestore(JsonObject*);
bool selectionCanPost(const std::string&, const std::string&);
void selectionPosted();
void selectionRetire();
void selectionShutdown();
void keysInit(const std::string& controlledDevice);
int inputDeviceCount();
bool controlledInput();
void keysShutdown();
bool canListen();
int64_t modifierFlags();
JsonObject* listen(JsonObject*);
JsonObject* armSessionShortcuts(JsonObject*);
JsonObject* record(JsonObject*);
void fence(bool);
void resetInput();
JsonObject* command(const std::string&, JsonObject*);
void serve();
}
