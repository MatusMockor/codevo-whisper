#include "stt-worker-request.h"

#include <string.h>

static const char * const LANGUAGES[] = { "sk", "en", "cs" };

static uint32_t decode_u32(const uint8_t * bytes) {
    return (uint32_t) bytes[0] | ((uint32_t) bytes[1] << 8) | ((uint32_t) bytes[2] << 16) | ((uint32_t) bytes[3] << 24);
}

static int valid_term(const uint8_t * bytes, size_t length) {
    size_t count = 0;
    for (size_t index = 0; index < length;) {
        const uint8_t first = bytes[index++];
        uint32_t point = first;
        size_t continuation = 0;
        uint32_t minimum = 0;
        if (first >= 0xc2 && first <= 0xdf) { point = first & 0x1f; continuation = 1; minimum = 0x80; }
        else if (first >= 0xe0 && first <= 0xef) { point = first & 0x0f; continuation = 2; minimum = 0x800; }
        else if (first >= 0xf0 && first <= 0xf4) { point = first & 0x07; continuation = 3; minimum = 0x10000; }
        else if (first >= 0x80) return 0;
        if (continuation > length - index) return 0;
        for (size_t rest = 0; rest < continuation; ++rest) {
            if ((bytes[index] & 0xc0) != 0x80) return 0;
            point = (point << 6) | (bytes[index++] & 0x3f);
        }
        if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return 0;
        if (point < 0x20 || (point >= 0x7f && point <= 0x9f)) return 0;
        if (++count > CW_MAX_TERM_CODEPOINTS) return 0;
    }
    return count > 0;
}

static enum cw_parse_status read_vocabulary(const uint8_t * data, size_t size, size_t offset, struct cw_request_header * out) {
    if (size <= offset) return CW_PARSE_INCOMPLETE;
    const uint8_t count = data[offset++];
    if (count > CW_MAX_VOCABULARY) return CW_PARSE_INVALID;
    for (uint8_t index = 0; index < count; ++index) {
        if (size - offset < 2) return CW_PARSE_INCOMPLETE;
        const size_t length = (size_t) data[offset] | ((size_t) data[offset + 1] << 8);
        offset += 2;
        if (length == 0 || length > CW_MAX_TERM_BYTES) return CW_PARSE_INVALID;
        if (size - offset < length) return CW_PARSE_INCOMPLETE;
        if (!valid_term(data + offset, length)) return CW_PARSE_INVALID;
        memcpy(out->terms[index], data + offset, length);
        out->terms[index][length] = '\0';
        out->vocabulary[index] = out->terms[index];
        offset += length;
    }
    out->n_vocabulary = count;
    out->header_bytes = offset;
    return CW_PARSE_OK;
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
    out->n_vocabulary = 0;
    const size_t base = data[0] == 0xff ? 1 : 0;
    if (size <= base) return CW_PARSE_INCOMPLETE;
    const size_t language_bytes = data[base];
    const size_t header_bytes   = base + 1 + language_bytes + 4;
    if (size < header_bytes) {
        return CW_PARSE_INCOMPLETE;
    }
    if (read_language(data + base + 1, language_bytes, out->language) != 0) {
        return CW_PARSE_INVALID;
    }
    const uint32_t samples = decode_u32(data + base + 1 + language_bytes);
    if (samples > CW_MAX_SAMPLES) {
        return CW_PARSE_INVALID;
    }
    out->header_bytes = header_bytes;
    out->samples      = samples;
    return base == 0 ? CW_PARSE_OK : read_vocabulary(data, size, header_bytes, out);
}

void cw_decode_samples(const uint8_t * data, uint32_t count, float * out) {
    for (uint32_t index = 0; index < count; ++index) {
        const int32_t raw    = (int32_t) data[2 * (size_t) index] | ((int32_t) data[2 * (size_t) index + 1] << 8);
        const int32_t signed_ = raw >= 32768 ? raw - 65536 : raw;
        out[index]            = (float) signed_ / 32768.0f;
    }
}
