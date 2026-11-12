#ifndef CW_STT_WORKER_ROLE_H
#define CW_STT_WORKER_ROLE_H

#include "stt-worker-request.h"
#include "transcribe.h"

enum cw_reply_status { CW_REPLY_OK = 0, CW_REPLY_FAILED = 1, CW_REPLY_READY = 2 };

enum cw_frame_kind { CW_FRAME_ASR, CW_FRAME_LANGID };

struct cw_frame {
    const struct cw_request_header * asr;
    const struct cw_langid_header *  langid;
    const float *                    samples;
    uint32_t                         n_samples;
};

struct cw_reply {
    uint8_t      status;
    const char * text;
};

struct cw_role {
    enum cw_frame_kind kind;
    void *             state;
    struct cw_reply (*answer)(void * state, const struct cw_frame * frame);
    void (*release)(void * state);
};

typedef transcribe_status (*cw_role_factory)(struct transcribe_model * model, int threads, struct cw_role * out);

transcribe_status cw_asr_role_open(struct transcribe_model * model, int threads, struct cw_role * out);

transcribe_status cw_langid_role_open(struct transcribe_model * model, int threads, struct cw_role * out);

#endif
