#ifndef CW_TEST_TRANSCRIBE_H
#define CW_TEST_TRANSCRIBE_H

#include <stdbool.h>
#include <stdint.h>

typedef enum { TRANSCRIBE_OK, TRANSCRIBE_ERR_MODEL, TRANSCRIBE_ERR_OOM, TRANSCRIBE_ERR_UNSUPPORTED_LANGUAGE, TRANSCRIBE_ERR_UNSUPPORTED_ROLE, TRANSCRIBE_ERR_INPUT_TOO_SHORT } transcribe_status;
typedef enum { TRANSCRIBE_BACKEND_AUTO, TRANSCRIBE_BACKEND_CPU, TRANSCRIBE_BACKEND_METAL, TRANSCRIBE_BACKEND_VULKAN } transcribe_backend_request;
typedef enum { TRANSCRIBE_ROLE_ASR = 1u << 0, TRANSCRIBE_ROLE_LANGID = 1u << 2 } transcribe_role;
struct transcribe_model_load_params { transcribe_backend_request backend; };
struct transcribe_session_params { int n_threads; };
typedef enum { TRANSCRIBE_FEATURE_VOCABULARY } transcribe_feature;
struct transcribe_model;
struct transcribe_run_params { const char * language; const char * const * vocabulary; int32_t n_vocabulary; };
struct transcribe_session;
const struct transcribe_model * transcribe_get_model(const struct transcribe_session *);
bool transcribe_model_supports(const struct transcribe_model *, transcribe_feature);
uint32_t transcribe_model_roles(const struct transcribe_model *);
void transcribe_model_load_params_init(struct transcribe_model_load_params *);
void transcribe_session_params_init(struct transcribe_session_params *);
void transcribe_run_params_init(struct transcribe_run_params *);
transcribe_status transcribe_model_load_file(const char *, const struct transcribe_model_load_params *, struct transcribe_model **);
void transcribe_model_free(struct transcribe_model *);
transcribe_status transcribe_session_init(struct transcribe_model *, const struct transcribe_session_params *, struct transcribe_session **);
transcribe_status transcribe_run(struct transcribe_session *, const float *, int, const struct transcribe_run_params *);
const char * transcribe_full_text(struct transcribe_session *);
const char * transcribe_status_string(int);
void transcribe_session_free(struct transcribe_session *);
#endif
