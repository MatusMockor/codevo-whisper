#include "../stt-worker-request.h"

#include <stdlib.h>
#include <string.h>

static float samples[CW_MAX_SAMPLES];

static void check_header(const struct cw_request_header * header, const uint8_t * frame) {
    const size_t language_bytes = strlen(header->language);
    if (header->samples > CW_MAX_SAMPLES || header->header_bytes != (size_t) frame[0] + 5 || language_bytes != frame[0]) {
        abort();
    }
    if (language_bytes != 0 && strcmp(header->language, "sk") != 0 && strcmp(header->language, "en") != 0 && strcmp(header->language, "cs") != 0) {
        abort();
    }
}

int LLVMFuzzerTestOneInput(const uint8_t * data, size_t size) {
    size_t offset = 0;
    while (offset < size) {
        struct cw_request_header header;
        if (cw_parse_header(data + offset, size - offset, &header) != CW_PARSE_OK) {
            return 0;
        }
        check_header(&header, data + offset);
        const size_t frame_bytes = header.header_bytes + (size_t) header.samples * 2;
        if (size - offset < frame_bytes) {
            return 0;
        }
        cw_decode_samples(data + offset + header.header_bytes, header.samples, samples);
        offset += frame_bytes;
    }
    return 0;
}
