#include "transcribe.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct transcribe_model { bool vocabulary; };
struct transcribe_session { char text[128]; struct transcribe_model model; };
const struct transcribe_model * transcribe_get_model(const struct transcribe_session * session) { return &session->model; }
bool transcribe_model_supports(const struct transcribe_model * model, transcribe_feature feature) { return feature == TRANSCRIBE_FEATURE_VOCABULARY && model->vocabulary; }
void transcribe_model_load_params_init(struct transcribe_model_load_params * p) { p->backend = TRANSCRIBE_BACKEND_AUTO; }
void transcribe_session_params_init(struct transcribe_session_params * p) { p->n_threads = 4; }
void transcribe_run_params_init(struct transcribe_run_params * p) { p->language = NULL; p->vocabulary = NULL; p->n_vocabulary = 0; }
transcribe_status transcribe_open(const char * path, const struct transcribe_model_load_params * load, const struct transcribe_session_params * params, struct transcribe_session ** out) {
    *out = NULL;
    fprintf(stderr, "OPEN %d %s %d\n", load->backend, path, params->n_threads);
    if (strcmp(path, "fail-both") == 0 || (strcmp(path, "fail-metal") == 0 && load->backend == TRANSCRIBE_BACKEND_METAL)) return TRANSCRIBE_ERR_MODEL;
    *out = calloc(1, sizeof **out);
    if (*out != NULL) (*out)->model.vocabulary = strcmp(path, "supports-vocabulary") == 0;
    return *out == NULL ? TRANSCRIBE_ERR_MODEL : TRANSCRIBE_OK;
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
const char * transcribe_status_string(transcribe_status status) { (void) status; return "run failed"; }
void transcribe_session_free(struct transcribe_session * session) { fprintf(stderr, "FREE\n"); free(session); }
