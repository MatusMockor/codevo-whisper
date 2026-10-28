#include "../stt-worker-request.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define CHECK(condition)                                                    \
    do {                                                                    \
        if (!(condition)) {                                                 \
            fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #condition); \
            failures += 1;                                                  \
        }                                                                   \
    } while (0)

static size_t frame(uint8_t * out, const char * language, size_t language_bytes, uint32_t samples) {
    out[0] = (uint8_t) language_bytes;
    memcpy(out + 1, language, language_bytes);
    out[1 + language_bytes]     = (uint8_t) samples;
    out[2 + language_bytes]     = (uint8_t) (samples >> 8);
    out[3 + language_bytes]     = (uint8_t) (samples >> 16);
    out[4 + language_bytes]     = (uint8_t) (samples >> 24);
    return 5 + language_bytes;
}

static enum cw_parse_status parse(const char * language, size_t language_bytes, uint32_t samples, struct cw_request_header * header) {
    uint8_t buffer[CW_MAX_HEADER_BYTES];
    const size_t size = frame(buffer, language, language_bytes, samples);
    return cw_parse_header(buffer, size, header);
}

static void accepts_the_whitelisted_languages(void) {
    struct cw_request_header header;
    CHECK(parse("sk", 2, 16000, &header) == CW_PARSE_OK);
    CHECK(strcmp(header.language, "sk") == 0);
    CHECK(header.header_bytes == 7);
    CHECK(header.samples == 16000);
    CHECK(parse("en", 2, 1, &header) == CW_PARSE_OK);
    CHECK(parse("cs", 2, 1, &header) == CW_PARSE_OK);
    CHECK(parse("", 0, 0, &header) == CW_PARSE_OK);
    CHECK(strcmp(header.language, "") == 0);
    CHECK(header.header_bytes == 5);
}

static void rejects_other_languages_and_embedded_nul(void) {
    struct cw_request_header header;
    char long_language[255];
    memset(long_language, 'a', sizeof long_language);
    CHECK(parse("de", 2, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse("SK", 2, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse("s\0", 2, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse("sk\0", 3, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse("s", 1, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse(long_language, 15, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse(long_language, 16, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse(long_language, 255, 1, &header) == CW_PARSE_INVALID);
}

static void bounds_the_sample_count(void) {
    struct cw_request_header header;
    CHECK(parse("sk", 2, CW_MAX_SAMPLES, &header) == CW_PARSE_OK);
    CHECK(parse("sk", 2, CW_MAX_SAMPLES + 1, &header) == CW_PARSE_INVALID);
    CHECK(parse("sk", 2, UINT32_MAX, &header) == CW_PARSE_INVALID);
}

static void reports_incomplete_headers(void) {
    struct cw_request_header header;
    uint8_t buffer[CW_MAX_HEADER_BYTES];
    const size_t size = frame(buffer, "sk", 2, 10);
    for (size_t prefix = 0; prefix < size; ++prefix) {
        CHECK(cw_parse_header(buffer, prefix, &header) == CW_PARSE_INCOMPLETE);
    }
    CHECK(cw_parse_header(NULL, 0, &header) == CW_PARSE_INCOMPLETE);
}

static void decodes_little_endian_pcm16(void) {
    const uint8_t pcm[] = { 0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0xff, 0xff };
    float         samples[4];
    cw_decode_samples(pcm, 4, samples);
    CHECK(samples[0] == 0.0f);
    CHECK(samples[1] == 32767.0f / 32768.0f);
    CHECK(samples[2] == -1.0f);
    CHECK(samples[3] == -1.0f / 32768.0f);
}

static void parses_extended_vocabulary_without_leaking_into_legacy_requests(void) {
    const uint8_t bytes[] = { 255, 2, 's', 'k', 1, 0, 0, 0, 2, 7, 0, 197, 189, 'i', 'l', 'i', 'n', 'a', 2, 0, 'A', 'I' };
    struct cw_request_header header;
    for (size_t prefix = 0; prefix < sizeof bytes; ++prefix) {
        CHECK(cw_parse_header(bytes, prefix, &header) == CW_PARSE_INCOMPLETE);
    }
    CHECK(cw_parse_header(bytes, sizeof bytes, &header) == CW_PARSE_OK);
    CHECK(header.header_bytes == sizeof bytes);
    CHECK(header.samples == 1);
    CHECK(header.n_vocabulary == 2);
    CHECK(strcmp(header.vocabulary[0], "Žilina") == 0);
    CHECK(strcmp(header.vocabulary[1], "AI") == 0);
    CHECK(parse("", 0, 1, &header) == CW_PARSE_OK);
    CHECK(header.n_vocabulary == 0);
}

int main(void) {
    accepts_the_whitelisted_languages();
    rejects_other_languages_and_embedded_nul();
    bounds_the_sample_count();
    reports_incomplete_headers();
    decodes_little_endian_pcm16();
    parses_extended_vocabulary_without_leaking_into_legacy_requests();
    if (failures > 0) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("request parser: all checks passed\n");
    return 0;
}
