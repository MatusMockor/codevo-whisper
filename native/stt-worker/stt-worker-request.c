#include "stt-worker-request.h"

#include <string.h>

static const char * const LANGUAGES[] = { "sk", "en", "cs" };

static uint32_t decode_u32(const uint8_t * bytes) {
    return (uint32_t) bytes[0] | ((uint32_t) bytes[1] << 8) | ((uint32_t) bytes[2] << 16) | ((uint32_t) bytes[3] << 24);
}

static int read_language(const uint8_t * bytes, size_t length, char out[3]) {
    out[0] = '\0';
    if (length == 0) {
        return 0;
    }
    if (length != 2) {
        return -1;
    }
    for (size_t index = 0; index < sizeof LANGUAGES / sizeof LANGUAGES[0]; ++index) {
        if (memcmp(bytes, LANGUAGES[index], 2) == 0) {
            memcpy(out, LANGUAGES[index], 3);
            return 0;
        }
    }
    return -1;
}

enum cw_parse_status cw_parse_header(const uint8_t * data, size_t size, struct cw_request_header * out) {
    if (data == NULL || size < 1) {
        return CW_PARSE_INCOMPLETE;
    }
    const size_t language_bytes = data[0];
    const size_t header_bytes   = 1 + language_bytes + 4;
    if (size < header_bytes) {
        return CW_PARSE_INCOMPLETE;
    }
    if (read_language(data + 1, language_bytes, out->language) != 0) {
        return CW_PARSE_INVALID;
    }
    const uint32_t samples = decode_u32(data + 1 + language_bytes);
    if (samples > CW_MAX_SAMPLES) {
        return CW_PARSE_INVALID;
    }
    out->header_bytes = header_bytes;
    out->samples      = samples;
    return CW_PARSE_OK;
}

void cw_decode_samples(const uint8_t * data, uint32_t count, float * out) {
    for (uint32_t index = 0; index < count; ++index) {
        const int32_t raw    = (int32_t) data[2 * (size_t) index] | ((int32_t) data[2 * (size_t) index + 1] << 8);
        const int32_t signed_ = raw >= 32768 ? raw - 65536 : raw;
        out[index]            = (float) signed_ / 32768.0f;
    }
}
