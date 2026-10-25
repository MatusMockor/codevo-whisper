#include "transcribe.h"

#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_SAMPLES (30 * 16000)
#define MAX_LANGUAGE 15

enum reply_status { REPLY_OK = 0, REPLY_FAILED = 1, REPLY_READY = 2 };

struct options {
    const char *               model;
    transcribe_backend_request backend;
    int                        threads;
};

static int read_exact(void * buffer, size_t size) {
    return fread(buffer, 1, size, stdin) == size ? 0 : -1;
}

static uint32_t decode_u32(const uint8_t * bytes) {
    return (uint32_t) bytes[0] | ((uint32_t) bytes[1] << 8) | ((uint32_t) bytes[2] << 16) | ((uint32_t) bytes[3] << 24);
}

static int write_reply(uint8_t status, const char * text) {
    const size_t  length    = strlen(text);
    const uint8_t header[5] = { status, (uint8_t) length, (uint8_t) (length >> 8), (uint8_t) (length >> 16), (uint8_t) (length >> 24) };
    if (fwrite(header, 1, sizeof header, stdout) != sizeof header || fwrite(text, 1, length, stdout) != length) {
        return -1;
    }
    return fflush(stdout);
}

static int parse_backend(const char * name, transcribe_backend_request * out) {
    static const struct { const char * name; transcribe_backend_request value; } backends[] = {
        { "cpu", TRANSCRIBE_BACKEND_CPU }, { "metal", TRANSCRIBE_BACKEND_METAL }, { "vulkan", TRANSCRIBE_BACKEND_VULKAN },
    };
    for (size_t index = 0; index < sizeof backends / sizeof backends[0]; ++index) {
        if (strcmp(name, backends[index].name) == 0) {
            *out = backends[index].value;
            return 0;
        }
    }
    return -1;
}

static int parse_options(int argc, char ** argv, struct options * out) {
    out->model   = NULL;
    out->backend = TRANSCRIBE_BACKEND_AUTO;
    out->threads = 0;
    for (int index = 1; index + 1 < argc; index += 2) {
        const char * name  = argv[index];
        const char * value = argv[index + 1];
        if (strcmp(name, "--model") == 0) {
            out->model = value;
            continue;
        }
        if (strcmp(name, "--backend") == 0 && parse_backend(value, &out->backend) == 0) {
            continue;
        }
        if (strcmp(name, "--threads") == 0) {
            out->threads = atoi(value);
            continue;
        }
        return -1;
    }
    return out->model == NULL || argc % 2 == 0 ? -1 : 0;
}

static struct transcribe_session * open_session(const struct options * options) {
    struct transcribe_model_load_params load;
    struct transcribe_session_params    params;
    struct transcribe_session *         session = NULL;
    transcribe_model_load_params_init(&load);
    transcribe_session_params_init(&params);
    load.backend     = options->backend;
    params.n_threads = options->threads;
    return transcribe_open(options->model, &load, &params, &session) == TRANSCRIBE_OK ? session : NULL;
}

static int read_request(char * language, float * samples, uint32_t * count) {
    uint8_t language_length = 0;
    uint8_t header[4];
    if (read_exact(&language_length, 1) != 0 || language_length > MAX_LANGUAGE || read_exact(language, language_length) != 0) {
        return -1;
    }
    language[language_length] = '\0';
    if (read_exact(header, sizeof header) != 0) {
        return -1;
    }
    *count = decode_u32(header);
    if (*count > MAX_SAMPLES) {
        return -1;
    }
    for (uint32_t index = 0; index < *count; ++index) {
        uint8_t sample[2];
        if (read_exact(sample, sizeof sample) != 0) {
            return -1;
        }
        samples[index] = (float) (int16_t) ((uint16_t) sample[0] | ((uint16_t) sample[1] << 8)) / 32768.0f;
    }
    return 0;
}

static int transcribe_request(struct transcribe_session * session, const char * language, const float * samples, uint32_t count) {
    struct transcribe_run_params run;
    transcribe_run_params_init(&run);
    run.language            = language[0] == '\0' ? NULL : language;
    const transcribe_status status = transcribe_run(session, samples, (int) count, &run);
    if (status != TRANSCRIBE_OK) {
        return write_reply(REPLY_FAILED, transcribe_status_string(status));
    }
    return write_reply(REPLY_OK, transcribe_full_text(session));
}

int main(int argc, char ** argv) {
    struct options options;
    signal(SIGPIPE, SIG_IGN);
    if (parse_options(argc, argv, &options) != 0) {
        fprintf(stderr, "usage: %s --model PATH [--backend cpu|metal|vulkan] [--threads N]\n", argv[0]);
        return 2;
    }
    struct transcribe_session * session = open_session(&options);
    if (session == NULL) {
        write_reply(REPLY_FAILED, "model load failed");
        return 1;
    }
    float * samples = malloc(sizeof(float) * MAX_SAMPLES);
    char    language[MAX_LANGUAGE + 1];
    uint32_t count = 0;
    int      exit_code = samples == NULL || write_reply(REPLY_READY, "") != 0 ? 1 : 0;
    while (exit_code == 0 && read_request(language, samples, &count) == 0) {
        exit_code = transcribe_request(session, language, samples, count) == 0 ? 0 : 1;
    }
    free(samples);
    transcribe_session_free(session);
    return exit_code;
}
