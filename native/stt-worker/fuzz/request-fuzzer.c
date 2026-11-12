#include "../stt-worker-request.h"

#include <stdlib.h>
#include <string.h>

static float samples[CW_MAX_SAMPLES];

static const char * const SUPPORTED[] = { "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it",
                                          "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk" };

static int supported(const char * language) {
    for (size_t index = 0; index < sizeof SUPPORTED / sizeof SUPPORTED[0]; ++index) {
        if (strcmp(language, SUPPORTED[index]) == 0) return 1;
    }
    return 0;
}

static void check_header(const struct cw_request_header * header, const uint8_t * frame) {
    const size_t language_bytes = strlen(header->language);
    const size_t base = frame[0] == 0xff ? 1 : 0;
    size_t header_bytes = base + language_bytes + 5;
    if (base != 0) {
        header_bytes += 1;
        for (uint8_t index = 0; index < header->n_vocabulary; ++index) header_bytes += 2 + strlen(header->vocabulary[index]);
    }
    if (header->samples > CW_MAX_SAMPLES || header->n_vocabulary > CW_MAX_VOCABULARY || header->header_bytes != header_bytes || language_bytes != frame[base]) {
        abort();
    }
    if (language_bytes != 0 && !supported(header->language)) {
        abort();
    }
}

static void check_code(const struct cw_langid_header * header, uint8_t index) {
    const size_t length = strlen(header->allowed[index]);
    if (header->allowed[index] != header->codes[index] || length < CW_MIN_CODE_BYTES || length > CW_MAX_CODE_BYTES) abort();
    for (size_t offset = 0; offset < length; ++offset) {
        if (header->allowed[index][offset] < 'a' || header->allowed[index][offset] > 'z') abort();
    }
    for (uint8_t other = 0; other < index; ++other) {
        if (strcmp(header->allowed[other], header->allowed[index]) == 0) abort();
    }
}

static void check_langid_header(const struct cw_langid_header * header, const uint8_t * frame) {
    if (frame[0] != CW_LANGID_TAG || header->n_allowed < 1 || header->n_allowed > CW_MAX_ALLOWED || header->n_allowed != frame[1] || header->samples > CW_MAX_SAMPLES) {
        abort();
    }
    size_t header_bytes = 2 + 4;
    for (uint8_t index = 0; index < header->n_allowed; ++index) {
        check_code(header, index);
        header_bytes += 1 + strlen(header->allowed[index]);
    }
    if (header->header_bytes != header_bytes || header_bytes > CW_MAX_LANGID_HEADER_BYTES) {
        abort();
    }
}

static int parse_frame(const uint8_t * data, size_t size, size_t * header_bytes, uint32_t * count) {
    if (data[0] == CW_LANGID_TAG) {
        struct cw_langid_header header;
        if (cw_parse_langid_header(data, size, &header) != CW_PARSE_OK) return -1;
        check_langid_header(&header, data);
        *header_bytes = header.header_bytes;
        *count        = header.samples;
        return 0;
    }
    struct cw_request_header header;
    if (cw_parse_header(data, size, &header) != CW_PARSE_OK) return -1;
    check_header(&header, data);
    *header_bytes = header.header_bytes;
    *count        = header.samples;
    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t * data, size_t size) {
    size_t offset = 0;
    while (offset < size) {
        size_t   header_bytes = 0;
        uint32_t count        = 0;
        if (parse_frame(data + offset, size - offset, &header_bytes, &count) != 0) {
            return 0;
        }
        const size_t frame_bytes = header_bytes + (size_t) count * 2;
        if (size - offset < frame_bytes) {
            return 0;
        }
        cw_decode_samples(data + offset + header_bytes, count, samples);
        offset += frame_bytes;
    }
    return 0;
}
