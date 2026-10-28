#include "stt-worker-request.h"
#include "transcribe.h"

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define EXIT_USAGE 2
#define EXIT_BAD_REQUEST 3

enum reply_status { REPLY_OK = 0, REPLY_FAILED = 1, REPLY_READY = 2 };

enum read_result { READ_OK, READ_END, READ_TRUNCATED, READ_INVALID };

struct options {
    const char *               model;
    transcribe_backend_request backend;
    int                        threads;
};

struct request {
    struct cw_request_header header;
    uint8_t *                pcm;
    float *                  samples;
};

static FILE * replies = NULL;

static int write_reply(uint8_t status, const char * text) {
    const size_t  length    = strlen(text);
    const uint8_t header[5] = { status, (uint8_t) length, (uint8_t) (length >> 8), (uint8_t) (length >> 16), (uint8_t) (length >> 24) };
    if (fwrite(header, 1, sizeof header, replies) != sizeof header || fwrite(text, 1, length, replies) != length) {
        return -1;
    }
    return fflush(replies);
}

static int redirect_stdout(void) {
    const int reply_fd = dup(STDOUT_FILENO);
    if (reply_fd < 0 || dup2(STDERR_FILENO, STDOUT_FILENO) < 0) {
        return -1;
    }
    replies = fdopen(reply_fd, "wb");
    return replies == NULL ? -1 : 0;
}

static int parse_backend(const char * name, transcribe_backend_request * out) {
    static const struct {
        const char *               name;
        transcribe_backend_request value;
    } backends[] = {
        { "cpu", TRANSCRIBE_BACKEND_CPU },
        { "metal", TRANSCRIBE_BACKEND_METAL },
        { "vulkan", TRANSCRIBE_BACKEND_VULKAN },
    };
    for (size_t index = 0; index < sizeof backends / sizeof backends[0]; ++index) {
        if (strcmp(name, backends[index].name) == 0) {
            *out = backends[index].value;
            return 0;
        }
    }
    return -1;
}

static int parse_threads(const char * value, int * out) {
    char * end = NULL;
    errno      = 0;
    const long threads = strtol(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || threads < 1 || threads > 256) {
        return -1;
    }
    *out = (int) threads;
    return 0;
}

static int parse_option(const char * name, const char * value, struct options * out) {
    if (strcmp(name, "--model") == 0 && value[0] != '\0') {
        out->model = value;
        return 0;
    }
    if (strcmp(name, "--backend") == 0) {
        return parse_backend(value, &out->backend);
    }
    if (strcmp(name, "--threads") == 0) {
        return parse_threads(value, &out->threads);
    }
    return -1;
}

static int parse_options(int argc, char ** argv, struct options * out) {
    out->model   = NULL;
    out->backend = TRANSCRIBE_BACKEND_AUTO;
    out->threads = 4;
    if (argc % 2 == 0) {
        return -1;
    }
    for (int index = 1; index + 1 < argc; index += 2) {
        if (parse_option(argv[index], argv[index + 1], out) != 0) {
            return -1;
        }
    }
    return out->model == NULL ? -1 : 0;
}

static struct transcribe_session * open_session(const struct options * options) {
    struct transcribe_model_load_params load;
    struct transcribe_session_params    params;
    struct transcribe_session *         session = NULL;
    transcribe_model_load_params_init(&load);
    transcribe_session_params_init(&params);
    load.backend     = options->backend;
    params.n_threads = options->threads;
    transcribe_status status = transcribe_open(options->model, &load, &params, &session);
#if defined(__APPLE__)
    if (status != TRANSCRIBE_OK && load.backend == TRANSCRIBE_BACKEND_METAL) {
        load.backend = TRANSCRIBE_BACKEND_CPU;
        status = transcribe_open(options->model, &load, &params, &session);
    }
#endif
    return status == TRANSCRIBE_OK ? session : NULL;
}

static size_t read_bytes(uint8_t * buffer, size_t size) {
    return fread(buffer, 1, size, stdin);
}

static enum read_result read_request(struct request * request) {
    uint8_t header[CW_MAX_HEADER_BYTES];
    if (read_bytes(header, 1) != 1) {
        return READ_END;
    }
    const size_t rest = (size_t) header[0] + 4;
    if (read_bytes(header + 1, rest) != rest) {
        return READ_TRUNCATED;
    }
    if (cw_parse_header(header, 1 + rest, &request->header) != CW_PARSE_OK) {
        return READ_INVALID;
    }
    const size_t pcm_bytes = (size_t) request->header.samples * 2;
    if (read_bytes(request->pcm, pcm_bytes) != pcm_bytes) {
        return READ_TRUNCATED;
    }
    cw_decode_samples(request->pcm, request->header.samples, request->samples);
    return READ_OK;
}

static int answer(struct transcribe_session * session, const struct request * request) {
    struct transcribe_run_params run;
    transcribe_run_params_init(&run);
    run.language                   = request->header.language[0] == '\0' ? NULL : request->header.language;
    const transcribe_status status = transcribe_run(session, request->samples, (int) request->header.samples, &run);
    if (status != TRANSCRIBE_OK) {
        return write_reply(REPLY_FAILED, transcribe_status_string(status));
    }
    const char * text = transcribe_full_text(session);
    if (text == NULL) {
        return write_reply(REPLY_OK, "");
    }
    if (strlen(text) > CW_MAX_OUTPUT_BYTES) {
        return write_reply(REPLY_FAILED, "transcript too large");
    }
    return write_reply(REPLY_OK, text);
}

static int serve(struct transcribe_session * session, struct request * request) {
    for (;;) {
        const enum read_result result = read_request(request);
        if (result == READ_END) {
            return EXIT_SUCCESS;
        }
        if (result == READ_INVALID) {
            write_reply(REPLY_FAILED, "invalid request");
            return EXIT_BAD_REQUEST;
        }
        if (result == READ_TRUNCATED) {
            return EXIT_BAD_REQUEST;
        }
        if (answer(session, request) != 0) {
            return EXIT_FAILURE;
        }
    }
}

int main(int argc, char ** argv) {
    struct options options;
    signal(SIGPIPE, SIG_IGN);
    if (redirect_stdout() != 0) {
        return EXIT_FAILURE;
    }
    if (parse_options(argc, argv, &options) != 0) {
        fprintf(stderr, "usage: %s --model PATH [--backend cpu|metal|vulkan] [--threads 1..256]\n", argv[0]);
        return EXIT_USAGE;
    }
    struct request request = { .pcm = malloc((size_t) CW_MAX_SAMPLES * 2), .samples = malloc(sizeof(float) * CW_MAX_SAMPLES) };
    if (request.pcm == NULL || request.samples == NULL) {
        write_reply(REPLY_FAILED, "out of memory");
        return EXIT_FAILURE;
    }
    struct transcribe_session * session = open_session(&options);
    if (session == NULL) {
        write_reply(REPLY_FAILED, "model load failed");
        return EXIT_FAILURE;
    }
    const int exit_code = write_reply(REPLY_READY, "") == 0 ? serve(session, &request) : EXIT_FAILURE;
    transcribe_session_free(session);
    free(request.pcm);
    free(request.samples);
    return exit_code;
}
