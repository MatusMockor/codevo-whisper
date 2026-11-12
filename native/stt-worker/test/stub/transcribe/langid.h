#ifndef CW_TEST_TRANSCRIBE_LANGID_H
#define CW_TEST_TRANSCRIBE_LANGID_H

#include "transcribe.h"

struct transcribe_langid_session;
struct transcribe_langid_session_params { int32_t n_threads; };
struct transcribe_langid_params { const char * const * allowed; int32_t n_allowed; };
struct transcribe_langid_result { int32_t n_candidates; float allowed_mass; };
struct transcribe_langid_candidate { int32_t index; const char * code; const char * name; float p; float logit; };
void transcribe_langid_session_params_init(struct transcribe_langid_session_params *);
void transcribe_langid_params_init(struct transcribe_langid_params *);
void transcribe_langid_result_init(struct transcribe_langid_result *);
void transcribe_langid_candidate_init(struct transcribe_langid_candidate *);
transcribe_status transcribe_langid_session_init(struct transcribe_model *, const struct transcribe_langid_session_params *, struct transcribe_langid_session **);
void transcribe_langid_session_free(struct transcribe_langid_session *);
transcribe_status transcribe_langid_run(struct transcribe_langid_session *, const float *, int, const struct transcribe_langid_params *);
transcribe_status transcribe_langid_get_result(const struct transcribe_langid_session *, struct transcribe_langid_result *);
transcribe_status transcribe_langid_get_candidate(const struct transcribe_langid_session *, int, struct transcribe_langid_candidate *);
#endif
