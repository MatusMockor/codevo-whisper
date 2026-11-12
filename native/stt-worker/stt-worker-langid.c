#include "stt-worker-role.h"
#include "transcribe/langid.h"

#include <stdio.h>
#include <stdlib.h>

#define CW_MAX_LANGID_REPLY_BYTES 1024

struct langid_state {
    struct transcribe_langid_session * session;
    char                               text[CW_MAX_LANGID_REPLY_BYTES];
};

static struct cw_reply reply(uint8_t status, const char * text) {
    const struct cw_reply result = { status, text };
    return result;
}

static int append_candidate(struct langid_state * state, int32_t index, size_t * used) {
    struct transcribe_langid_candidate candidate;
    transcribe_langid_candidate_init(&candidate);
    if (transcribe_langid_get_candidate(state->session, index, &candidate) != TRANSCRIBE_OK || candidate.code == NULL) {
        return -1;
    }
    const size_t room    = sizeof state->text - *used;
    const int    written = snprintf(state->text + *used, room, "%s %.9g\n", candidate.code, (double) candidate.p);
    if (written < 0 || (size_t) written >= room) {
        return -1;
    }
    *used += (size_t) written;
    return 0;
}

static int format_ranking(struct langid_state * state) {
    struct transcribe_langid_result result;
    transcribe_langid_result_init(&result);
    if (transcribe_langid_get_result(state->session, &result) != TRANSCRIBE_OK) {
        return -1;
    }
    size_t used    = 0;
    state->text[0] = '\0';
    for (int32_t index = 0; index < result.n_candidates; ++index) {
        if (append_candidate(state, index, &used) != 0) {
            return -1;
        }
    }
    return 0;
}

static struct cw_reply answer(void * opaque, const struct cw_frame * frame) {
    struct langid_state *           state = opaque;
    struct transcribe_langid_params params;
    transcribe_langid_params_init(&params);
    params.allowed                 = frame->langid->allowed;
    params.n_allowed               = frame->langid->n_allowed;
    const transcribe_status status = transcribe_langid_run(state->session, frame->samples, (int) frame->n_samples, &params);
    if (status != TRANSCRIBE_OK) {
        return reply(CW_REPLY_FAILED, transcribe_status_string(status));
    }
    if (format_ranking(state) != 0) {
        return reply(CW_REPLY_FAILED, "invalid langid result");
    }
    return reply(CW_REPLY_OK, state->text);
}

static void release(void * opaque) {
    struct langid_state * state = opaque;
    transcribe_langid_session_free(state->session);
    free(state);
}

transcribe_status cw_langid_role_open(struct transcribe_model * model, int threads, struct cw_role * out) {
    struct langid_state * state = calloc(1, sizeof *state);
    if (state == NULL) {
        return TRANSCRIBE_ERR_OOM;
    }
    struct transcribe_langid_session_params params;
    transcribe_langid_session_params_init(&params);
    params.n_threads               = threads;
    const transcribe_status status = transcribe_langid_session_init(model, &params, &state->session);
    if (status != TRANSCRIBE_OK) {
        free(state);
        return status;
    }
    out->kind    = CW_FRAME_LANGID;
    out->state   = state;
    out->answer  = answer;
    out->release = release;
    return TRANSCRIBE_OK;
}
