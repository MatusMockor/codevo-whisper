#include "transcribe.h"
#include "transcribe/langid.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct transcribe_model { bool vocabulary; bool session_fails; uint32_t roles; };
struct transcribe_session { char text[128]; const struct transcribe_model * model; };
struct transcribe_langid_session { int32_t count; char codes[32][4]; float p[32]; };
static bool has_prefix(const char * path, const char * prefix) { return strncmp(path, prefix, strlen(prefix)) == 0; }
static uint32_t roles_for(const char * path) {
    if (has_prefix(path, "no-role")) return 0;
    if (has_prefix(path, "langid")) return TRANSCRIBE_ROLE_LANGID;
    return TRANSCRIBE_ROLE_ASR;
}
const struct transcribe_model * transcribe_get_model(const struct transcribe_session * session) { return session->model; }
bool transcribe_model_supports(const struct transcribe_model * model, transcribe_feature feature) { return feature == TRANSCRIBE_FEATURE_VOCABULARY && model->vocabulary; }
uint32_t transcribe_model_roles(const struct transcribe_model * model) { return model->roles; }
void transcribe_model_load_params_init(struct transcribe_model_load_params * p) { p->backend = TRANSCRIBE_BACKEND_AUTO; }
void transcribe_session_params_init(struct transcribe_session_params * p) { p->n_threads = 4; }
void transcribe_run_params_init(struct transcribe_run_params * p) { p->language = NULL; p->vocabulary = NULL; p->n_vocabulary = 0; }
transcribe_status transcribe_model_load_file(const char * path, const struct transcribe_model_load_params * load, struct transcribe_model ** out) {
    *out = NULL;
    fprintf(stderr, "LOAD %d %s\n", load->backend, path);
    if (strcmp(path, "fail-both") == 0 || (strcmp(path, "fail-metal") == 0 && load->backend == TRANSCRIBE_BACKEND_METAL)) return TRANSCRIBE_ERR_MODEL;
    *out = calloc(1, sizeof **out);
    if (*out == NULL) return TRANSCRIBE_ERR_MODEL;
    (*out)->vocabulary = strcmp(path, "supports-vocabulary") == 0;
    (*out)->roles = roles_for(path);
    (*out)->session_fails = strcmp(path, "langid-session-fails-on-metal") == 0 && load->backend == TRANSCRIBE_BACKEND_METAL;
    return TRANSCRIBE_OK;
}
void transcribe_model_free(struct transcribe_model * model) { fprintf(stderr, "UNLOAD\n"); free(model); }
transcribe_status transcribe_session_init(struct transcribe_model * model, const struct transcribe_session_params * params, struct transcribe_session ** out) {
    *out = NULL;
    fprintf(stderr, "SESSION %d\n", params->n_threads);
    if ((model->roles & TRANSCRIBE_ROLE_ASR) == 0) return TRANSCRIBE_ERR_UNSUPPORTED_ROLE;
    *out = calloc(1, sizeof **out);
    if (*out == NULL) return TRANSCRIBE_ERR_MODEL;
    (*out)->model = model;
    return TRANSCRIBE_OK;
}
transcribe_status transcribe_run(struct transcribe_session * session, const float * samples, int count, const struct transcribe_run_params * run) {
    fprintf(stderr, "RUN\n");
    if (getenv("CW_TEST_VOCABULARY") != NULL) {
        fprintf(stderr, "VOCABULARY %d", run->n_vocabulary);
        for (int32_t index = 0; index < run->n_vocabulary; ++index) fprintf(stderr, " [%s]", run->vocabulary[index]);
        fprintf(stderr, "\n");
    }
    if (count == 2) return TRANSCRIBE_ERR_MODEL;
    snprintf(session->text, sizeof session->text, "%s %d %.2f", run->language == NULL ? "auto" : run->language, count, samples[0]);
    return TRANSCRIBE_OK;
}
const char * transcribe_full_text(struct transcribe_session * session) { return session->text; }
const char * transcribe_status_string(int status) {
    if (status == TRANSCRIBE_ERR_INPUT_TOO_SHORT) return "input audio too short";
    if (status == TRANSCRIBE_ERR_UNSUPPORTED_LANGUAGE) return "unsupported language";
    return "run failed";
}
void transcribe_session_free(struct transcribe_session * session) { fprintf(stderr, "FREE\n"); free(session); }
void transcribe_langid_session_params_init(struct transcribe_langid_session_params * p) { p->n_threads = 0; }
void transcribe_langid_params_init(struct transcribe_langid_params * p) { p->allowed = NULL; p->n_allowed = 0; }
void transcribe_langid_result_init(struct transcribe_langid_result * p) { memset(p, 0, sizeof *p); }
void transcribe_langid_candidate_init(struct transcribe_langid_candidate * p) { memset(p, 0, sizeof *p); }
transcribe_status transcribe_langid_session_init(struct transcribe_model * model, const struct transcribe_langid_session_params * params, struct transcribe_langid_session ** out) {
    *out = NULL;
    fprintf(stderr, "LANGID SESSION %d\n", params->n_threads);
    if ((model->roles & TRANSCRIBE_ROLE_LANGID) == 0 || model->session_fails) return TRANSCRIBE_ERR_UNSUPPORTED_ROLE;
    *out = calloc(1, sizeof **out);
    return *out == NULL ? TRANSCRIBE_ERR_OOM : TRANSCRIBE_OK;
}
void transcribe_langid_session_free(struct transcribe_langid_session * session) { fprintf(stderr, "FREE\n"); free(session); }
transcribe_status transcribe_langid_run(struct transcribe_langid_session * session, const float * pcm, int count, const struct transcribe_langid_params * params) {
    fprintf(stderr, "LANGID %d", params->n_allowed);
    for (int32_t index = 0; index < params->n_allowed; ++index) fprintf(stderr, " [%s]", params->allowed[index]);
    fprintf(stderr, " %.2f\n", count > 0 ? pcm[0] : 0.0f);
    if (count < 8000) return TRANSCRIBE_ERR_INPUT_TOO_SHORT;
    for (int32_t index = 0; index < params->n_allowed; ++index) {
        if (strcmp(params->allowed[index], "xx") == 0) return TRANSCRIBE_ERR_UNSUPPORTED_LANGUAGE;
    }
    float remaining = 1.0f;
    session->count = params->n_allowed;
    for (int32_t rank = 0; rank < params->n_allowed; ++rank) {
        snprintf(session->codes[rank], sizeof session->codes[rank], "%s", params->allowed[params->n_allowed - 1 - rank]);
        session->p[rank] = rank + 1 == params->n_allowed ? remaining : remaining / 2.0f;
        remaining -= session->p[rank];
    }
    return TRANSCRIBE_OK;
}
transcribe_status transcribe_langid_get_result(const struct transcribe_langid_session * session, struct transcribe_langid_result * out) {
    out->n_candidates = session->count;
    out->allowed_mass = 1.0f;
    return TRANSCRIBE_OK;
}
transcribe_status transcribe_langid_get_candidate(const struct transcribe_langid_session * session, int index, struct transcribe_langid_candidate * out) {
    memset(out, 0, sizeof *out);
    if (index < 0 || index >= session->count) return TRANSCRIBE_OK;
    out->index = index;
    out->code = session->codes[index];
    out->p = session->p[index];
    return TRANSCRIBE_OK;
}
