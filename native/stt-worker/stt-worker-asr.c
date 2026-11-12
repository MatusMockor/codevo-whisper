#include "stt-worker-role.h"

#include <string.h>

static struct cw_reply reply(uint8_t status, const char * text) {
    const struct cw_reply result = { status, text };
    return result;
}

static struct cw_reply answer(void * state, const struct cw_frame * frame) {
    struct transcribe_session *  session = state;
    struct transcribe_run_params run;
    transcribe_run_params_init(&run);
    run.language = frame->asr->language[0] == '\0' ? NULL : frame->asr->language;
    if (frame->asr->n_vocabulary > 0 && transcribe_model_supports(transcribe_get_model(session), TRANSCRIBE_FEATURE_VOCABULARY)) {
        run.vocabulary   = frame->asr->vocabulary;
        run.n_vocabulary = frame->asr->n_vocabulary;
    }
    const transcribe_status status = transcribe_run(session, frame->samples, (int) frame->n_samples, &run);
    if (status != TRANSCRIBE_OK) {
        return reply(CW_REPLY_FAILED, transcribe_status_string(status));
    }
    const char * text = transcribe_full_text(session);
    if (text == NULL) {
        return reply(CW_REPLY_OK, "");
    }
    if (strlen(text) > CW_MAX_OUTPUT_BYTES) {
        return reply(CW_REPLY_FAILED, "transcript too large");
    }
    return reply(CW_REPLY_OK, text);
}

static void release(void * state) {
    transcribe_session_free(state);
}

transcribe_status cw_asr_role_open(struct transcribe_model * model, int threads, struct cw_role * out) {
    struct transcribe_session_params params;
    struct transcribe_session *      session = NULL;
    transcribe_session_params_init(&params);
    params.n_threads               = threads;
    const transcribe_status status = transcribe_session_init(model, &params, &session);
    if (status != TRANSCRIBE_OK) {
        return status;
    }
    out->kind    = CW_FRAME_ASR;
    out->state   = session;
    out->answer  = answer;
    out->release = release;
    return TRANSCRIBE_OK;
}
