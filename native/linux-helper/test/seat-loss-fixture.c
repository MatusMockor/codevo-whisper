#define _GNU_SOURCE
#include <gio/gio.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int is(const char *mode, const char *name) { return strcmp(mode, name) == 0; }

GVariant *g_dbus_connection_call_sync(GDBusConnection *connection, const gchar *bus_name, const gchar *object_path, const gchar *interface_name, const gchar *method_name, GVariant *parameters, const GVariantType *reply_type, GDBusCallFlags flags, gint timeout_msec, GCancellable *cancellable, GError **error) {
    GVariant *(*call)(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *, const GVariantType *, GDBusCallFlags, gint, GCancellable *, GError **) = dlsym(RTLD_NEXT, "g_dbus_connection_call_sync");
    const char *path = getenv("CW_FIXTURE_SEAT_FILE");
    char mode[32] = {0};
    if (path) {
        FILE *file = fopen(path, "r");
        if (file) { fgets(mode, sizeof(mode), file); fclose(file); }
    }
    if (*mode && bus_name && strcmp(bus_name, "org.freedesktop.login1") == 0 && strcmp(method_name, "GetAll") == 0 && strstr(object_path, "/session/")) {
        if (is(mode, "error")) {
            g_set_error_literal(error, G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED, "controlled login1 query refusal");
            return NULL;
        }
        GVariantBuilder props;
        g_variant_builder_init(&props, G_VARIANT_TYPE("a{sv}"));
        g_variant_builder_add(&props, "{sv}", "Active", g_variant_new_boolean(!is(mode, "inactive")));
        g_variant_builder_add(&props, "{sv}", "LockedHint", g_variant_new_boolean(is(mode, "locked") || is(mode, "stale-locked") || is(mode, "locked-unknown")));
        return g_variant_ref_sink(g_variant_new("(a{sv})", &props));
    }
    if (*mode && bus_name && strcmp(bus_name, "org.gnome.ScreenSaver") == 0 && strcmp(method_name, "GetActive") == 0) {
        if (is(mode, "locked-unknown")) {
            g_set_error_literal(error, G_DBUS_ERROR, G_DBUS_ERROR_SERVICE_UNKNOWN, "controlled screen saver absence");
            return NULL;
        }
        return g_variant_ref_sink(g_variant_new("(b)", !is(mode, "stale-locked")));
    }
    return call(connection, bus_name, object_path, interface_name, method_name, parameters, reply_type, flags, timeout_msec, cancellable, error);
}
