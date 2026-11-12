#ifndef CW_STT_WORKER_REQUEST_H
#define CW_STT_WORKER_REQUEST_H

#include <stddef.h>
#include <stdint.h>

#define CW_SAMPLE_RATE 16000
#define CW_MAX_SAMPLES (30 * CW_SAMPLE_RATE)
#define CW_MAX_VOCABULARY 100
#define CW_MAX_TERM_BYTES 256
#define CW_MAX_TERM_CODEPOINTS 64
#define CW_MAX_HEADER_BYTES (1 + 1 + 255 + 4 + 1 + CW_MAX_VOCABULARY * (2 + CW_MAX_TERM_BYTES))
#define CW_MAX_OUTPUT_BYTES 16000
#define CW_LANGID_TAG 0xfe
#define CW_MAX_ALLOWED 32
#define CW_MIN_CODE_BYTES 2
#define CW_MAX_CODE_BYTES 3
#define CW_MAX_LANGID_HEADER_BYTES (1 + 1 + CW_MAX_ALLOWED * (1 + CW_MAX_CODE_BYTES) + 4)

enum cw_parse_status { CW_PARSE_OK = 0, CW_PARSE_INCOMPLETE = 1, CW_PARSE_INVALID = 2 };

struct cw_request_header {
    char     language[3];
    size_t   header_bytes;
    uint32_t samples;
    uint8_t  n_vocabulary;
    char     terms[CW_MAX_VOCABULARY][CW_MAX_TERM_BYTES + 1];
    const char * vocabulary[CW_MAX_VOCABULARY];
};

struct cw_langid_header {
    size_t       header_bytes;
    uint32_t     samples;
    uint8_t      n_allowed;
    char         codes[CW_MAX_ALLOWED][CW_MAX_CODE_BYTES + 1];
    const char * allowed[CW_MAX_ALLOWED];
};

enum cw_parse_status cw_parse_header(const uint8_t * data, size_t size, struct cw_request_header * out);

enum cw_parse_status cw_parse_langid_header(const uint8_t * data, size_t size, struct cw_langid_header * out);

void cw_decode_samples(const uint8_t * data, uint32_t count, float * out);

#endif
