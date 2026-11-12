#include "stt-worker-request.h"
#include "stt-worker-role.h"
#include "transcribe.h"

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define EXIT_USAGE 2
#define EXIT_BAD_REQUEST 3

enum read_result { READ_OK, READ_END, READ_TRUNCATED, READ_INVALID };

struct options {
    const char *               model;
    transcribe_backend_request backend;
    int                        threads;
};

struct request {
    enum cw_frame_kind       kind;
    struct cw_request_header asr;
    struct cw_langid_header  langid;
    uint32_t                 n_samples;
    uint8_t *                pcm;
    float *                  samples;
};

struct worker {
    struct transcribe_model * model;
    struct cw_role            role;
};

static const struct {
    uint32_t        role;
    cw_role_factory open;
} ROLES[] = {
    { TRANSCRIBE_ROLE_ASR, cw_asr_role_open },
    { TRANSCRIBE_ROLE_LANGID, cw_langid_role_open },
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
        { "auto", TRANSCRIBE_BACKEND_AUTO },
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

static transcribe_status open_role(struct transcribe_model * model, int threads, struct cw_role * out) {
    const uint32_t roles = transcribe_model_roles(model);
    for (size_t index = 0; index < sizeof ROLES / sizeof ROLES[0]; ++index) {
        if ((roles & ROLES[index].role) != 0) {
            return ROLES[index].open(model, threads, out);
        }
    }
    return TRANSCRIBE_ERR_UNSUPPORTED_ROLE;
}

static transcribe_status open_worker(const struct options * options, transcribe_backend_request backend, struct worker * out) {
    struct transcribe_model_load_params load;
    transcribe_model_load_params_init(&load);
    load.backend                   = backend;
    out->model                     = NULL;
    const transcribe_status loaded = transcribe_model_load_file(options->model, &load, &out->model);
    if (loaded != TRANSCRIBE_OK) {
        return loaded;
    }
    const transcribe_status opened = open_role(out->model, options->threads, &out->role);
    if (opened != TRANSCRIBE_OK) {
        transcribe_model_free(out->model);
        out->model = NULL;
    }
    return opened;
}

static int start_worker(const struct options * options, struct worker * out) {
    transcribe_status status = open_worker(options, options->backend, out);
#if defined(__APPLE__)
    if (status != TRANSCRIBE_OK && options->backend == TRANSCRIBE_BACKEND_METAL) {
        status = open_worker(options, TRANSCRIBE_BACKEND_CPU, out);
    }
#endif
    return status == TRANSCRIBE_OK ? 0 : -1;
}

static void stop_worker(struct worker * worker) {
    worker->role.release(worker->role.state);
    transcribe_model_free(worker->model);
}

static size_t read_bytes(uint8_t * buffer, size_t size) {
    return fread(buffer, 1, size, stdin);
}

static enum read_result read_asr_header(uint8_t first, struct request * request) {
    uint8_t header[CW_MAX_HEADER_BYTES];
    header[0] = first;
    const size_t base = header[0] == 0xff ? 1 : 0;
    if (base != 0 && read_bytes(header + 1, 1) != 1) return READ_TRUNCATED;
    const size_t rest = (size_t) header[base] + 4;
    if (read_bytes(header + base + 1, rest) != rest) {
        return READ_TRUNCATED;
    }
    size_t length = base + 1 + rest;
    if (base != 0) {
        if (read_bytes(header + length, 1) != 1) return READ_TRUNCATED;
        const uint8_t count = header[length++];
        if (count > CW_MAX_VOCABULARY) return READ_INVALID;
        for (uint8_t index = 0; index < count; ++index) {
            if (read_bytes(header + length, 2) != 2) return READ_TRUNCATED;
            const size_t term_bytes = (size_t) header[length] | ((size_t) header[length + 1] << 8);
            length += 2;
            if (term_bytes == 0 || term_bytes > CW_MAX_TERM_BYTES) return READ_INVALID;
            if (read_bytes(header + length, term_bytes) != term_bytes) return READ_TRUNCATED;
            length += term_bytes;
        }
    }
    if (cw_parse_header(header, length, &request->asr) != CW_PARSE_OK) {
        return READ_INVALID;
    }
    request->kind      = CW_FRAME_ASR;
    request->n_samples = request->asr.samples;
    return READ_OK;
}

static enum read_result read_langid_header(struct request * request) {
    uint8_t header[CW_MAX_LANGID_HEADER_BYTES] = { CW_LANGID_TAG };
    size_t  length = 1;
    enum cw_parse_status status = cw_parse_langid_header(header, length, &request->langid);
    while (status == CW_PARSE_INCOMPLETE && length < sizeof header) {
        if (read_bytes(header + length, 1) != 1) {
            return READ_TRUNCATED;
        }
        length += 1;
        status = cw_parse_langid_header(header, length, &request->langid);
    }
    if (status != CW_PARSE_OK) {
        return READ_INVALID;
    }
    request->kind      = CW_FRAME_LANGID;
    request->n_samples = request->langid.samples;
    return READ_OK;
}

static enum read_result read_request(struct request * request) {
    uint8_t first = 0;
    if (read_bytes(&first, 1) != 1) {
        return READ_END;
    }
    const enum read_result header = first == CW_LANGID_TAG ? read_langid_header(request) : read_asr_header(first, request);
    if (header != READ_OK) {
        return header;
    }
    const size_t pcm_bytes = (size_t) request->n_samples * 2;
    if (read_bytes(request->pcm, pcm_bytes) != pcm_bytes) {
        return READ_TRUNCATED;
    }
    cw_decode_samples(request->pcm, request->n_samples, request->samples);
    return READ_OK;
}

static int answer(const struct cw_role * role, const struct request * request) {
    if (request->kind != role->kind) {
        return write_reply(CW_REPLY_FAILED, "wrong role");
    }
    const struct cw_frame frame = { &request->asr, &request->langid, request->samples, request->n_samples };
    const struct cw_reply reply = role->answer(role->state, &frame);
    return write_reply(reply.status, reply.text);
}

static int serve(const struct cw_role * role, struct request * request) {
    for (;;) {
        const enum read_result result = read_request(request);
        if (result == READ_END) {
            return EXIT_SUCCESS;
        }
        if (result == READ_INVALID) {
            write_reply(CW_REPLY_FAILED, "invalid request");
            return EXIT_BAD_REQUEST;
        }
        if (result == READ_TRUNCATED) {
            return EXIT_BAD_REQUEST;
        }
        if (answer(role, request) != 0) {
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
        write_reply(CW_REPLY_FAILED, "out of memory");
        return EXIT_FAILURE;
    }
    struct worker worker;
    if (start_worker(&options, &worker) != 0) {
        write_reply(CW_REPLY_FAILED, "model load failed");
        return EXIT_FAILURE;
    }
    const int exit_code = write_reply(CW_REPLY_READY, "") == 0 ? serve(&worker.role, &request) : EXIT_FAILURE;
    stop_worker(&worker);
    free(request.pcm);
    free(request.samples);
    return exit_code;
}
