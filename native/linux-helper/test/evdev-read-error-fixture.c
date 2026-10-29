#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <libevdev/libevdev.h>
#include <stdio.h>

int libevdev_next_event(struct libevdev *device, unsigned int flags, struct input_event *event) {
    static int presses = 0;
    static int injected = 0;
    int (*next)(struct libevdev *, unsigned int, struct input_event *) = dlsym(RTLD_NEXT, "libevdev_next_event");
    int result = next(device, flags, event);
    if (result == 0 && flags == LIBEVDEV_READ_FLAG_NORMAL) {
        if (event->type == EV_KEY && event->code == KEY_RIGHTCTRL && event->value == 1) presses++;
        if (!injected && presses == 3 && event->type == EV_SYN && event->code == SYN_REPORT) {
            injected = 1;
            fprintf(stderr, "CONTROLLED_LIBEVDEV_READ_ERROR_SAME_NODE\n");
            return -EIO;
        }
    }
    return result;
}
