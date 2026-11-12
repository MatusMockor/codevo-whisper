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

static const char * const SUPPORTED[] = { "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it",
                                          "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk" };

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
    for (size_t index = 0; index < sizeof SUPPORTED / sizeof SUPPORTED[0]; ++index) {
        CHECK(parse(SUPPORTED[index], 2, 1, &header) == CW_PARSE_OK);
        CHECK(strcmp(header.language, SUPPORTED[index]) == 0);
    }
    CHECK(parse("", 0, 0, &header) == CW_PARSE_OK);
    CHECK(strcmp(header.language, "") == 0);
    CHECK(header.header_bytes == 5);
}

static void rejects_other_languages_and_embedded_nul(void) {
    struct cw_request_header header;
    char long_language[255];
    memset(long_language, 'a', sizeof long_language);
    CHECK(parse("xx", 2, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse("ja", 2, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse("no", 2, 1, &header) == CW_PARSE_INVALID);
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

static size_t langid_frame(uint8_t * out, const char * const * codes, size_t count, uint32_t samples) {
    size_t size = 0;
    out[size++]  = CW_LANGID_TAG;
    out[size++]  = (uint8_t) count;
    for (size_t index = 0; index < count; ++index) {
        const size_t length = strlen(codes[index]);
        out[size++]         = (uint8_t) length;
        memcpy(out + size, codes[index], length);
        size += length;
    }
    for (size_t shift = 0; shift < 32; shift += 8) out[size++] = (uint8_t) (samples >> shift);
    return size;
}

static enum cw_parse_status parse_langid(const char * const * codes, size_t count, uint32_t samples, struct cw_langid_header * header) {
    uint8_t      buffer[CW_MAX_LANGID_HEADER_BYTES + 64];
    const size_t size = langid_frame(buffer, codes, count, samples);
    return cw_parse_langid_header(buffer, size, header);
}

static void parses_a_langid_header(void) {
    const char * const      codes[] = { "sk", "cs", "en" };
    struct cw_langid_header header;
    CHECK(parse_langid(codes, 3, 8000, &header) == CW_PARSE_OK);
    CHECK(header.n_allowed == 3);
    CHECK(header.samples == 8000);
    CHECK(header.header_bytes == 2 + 3 * 3 + 4);
    CHECK(strcmp(header.allowed[0], "sk") == 0);
    CHECK(strcmp(header.allowed[1], "cs") == 0);
    CHECK(strcmp(header.allowed[2], "en") == 0);
    CHECK(parse_langid(SUPPORTED, sizeof SUPPORTED / sizeof SUPPORTED[0], 1, &header) == CW_PARSE_OK);
    CHECK(header.n_allowed == 25);
    const char * const three[] = { "yue" };
    CHECK(parse_langid(three, 1, 0, &header) == CW_PARSE_OK);
    CHECK(strcmp(header.allowed[0], "yue") == 0);
}

static void bounds_the_allowed_count(void) {
    char                    storage[CW_MAX_ALLOWED + 1][4];
    const char *            codes[CW_MAX_ALLOWED + 1];
    struct cw_langid_header header;
    for (size_t index = 0; index <= CW_MAX_ALLOWED; ++index) {
        snprintf(storage[index], sizeof storage[index], "a%c%c", 'a' + (int) (index / 26), 'a' + (int) (index % 26));
        codes[index] = storage[index];
    }
    CHECK(parse_langid(codes, CW_MAX_ALLOWED, 1, &header) == CW_PARSE_OK);
    CHECK(header.n_allowed == CW_MAX_ALLOWED);
    CHECK(header.header_bytes == CW_MAX_LANGID_HEADER_BYTES);
    CHECK(parse_langid(codes, CW_MAX_ALLOWED + 1, 1, &header) == CW_PARSE_INVALID);
    CHECK(parse_langid(codes, 0, 1, &header) == CW_PARSE_INVALID);
    const uint8_t zero[] = { CW_LANGID_TAG, 0 };
    CHECK(cw_parse_langid_header(zero, sizeof zero, &header) == CW_PARSE_INVALID);
    const uint8_t over[] = { CW_LANGID_TAG, CW_MAX_ALLOWED + 1 };
    CHECK(cw_parse_langid_header(over, sizeof over, &header) == CW_PARSE_INVALID);
}

static void rejects_invalid_langid_codes(void) {
    struct cw_langid_header header;
    const char * const      invalid[][1] = { { "s" }, { "slov" }, { "SK" }, { "s1" }, { "s-" }, { "" } };
    for (size_t index = 0; index < sizeof invalid / sizeof invalid[0]; ++index) {
        CHECK(parse_langid(invalid[index], 1, 1, &header) == CW_PARSE_INVALID);
    }
    const uint8_t nul[] = { CW_LANGID_TAG, 1, 2, 's', 0, 1, 0, 0, 0 };
    CHECK(cw_parse_langid_header(nul, sizeof nul, &header) == CW_PARSE_INVALID);
    const uint8_t high[] = { CW_LANGID_TAG, 1, 2, 's', 0xe1, 1, 0, 0, 0 };
    CHECK(cw_parse_langid_header(high, sizeof high, &header) == CW_PARSE_INVALID);
    const char * const duplicate[] = { "sk", "cs", "sk" };
    CHECK(parse_langid(duplicate, 3, 1, &header) == CW_PARSE_INVALID);
    const uint8_t early[] = { CW_LANGID_TAG, 2, 9 };
    CHECK(cw_parse_langid_header(early, sizeof early, &header) == CW_PARSE_INVALID);
    const uint8_t asr[] = { 2, 's', 'k', 1, 0, 0, 0 };
    CHECK(cw_parse_langid_header(asr, sizeof asr, &header) == CW_PARSE_INVALID);
}

static void bounds_the_langid_sample_count(void) {
    const char * const      codes[] = { "sk" };
    struct cw_langid_header header;
    CHECK(parse_langid(codes, 1, CW_MAX_SAMPLES, &header) == CW_PARSE_OK);
    CHECK(header.samples == CW_MAX_SAMPLES);
    CHECK(parse_langid(codes, 1, CW_MAX_SAMPLES + 1, &header) == CW_PARSE_INVALID);
    CHECK(parse_langid(codes, 1, UINT32_MAX, &header) == CW_PARSE_INVALID);
}

static void reports_incomplete_langid_headers(void) {
    const char * const      codes[] = { "sk", "yue" };
    uint8_t                 buffer[CW_MAX_LANGID_HEADER_BYTES];
    struct cw_langid_header header;
    const size_t            size = langid_frame(buffer, codes, 2, 8000);
    for (size_t prefix = 0; prefix < size; ++prefix) {
        CHECK(cw_parse_langid_header(buffer, prefix, &header) == CW_PARSE_INCOMPLETE);
    }
    CHECK(cw_parse_langid_header(buffer, size, &header) == CW_PARSE_OK);
    CHECK(header.header_bytes == size);
    CHECK(cw_parse_langid_header(NULL, 0, &header) == CW_PARSE_INCOMPLETE);
}

static void legacy_parser_still_rejects_the_langid_tag(void) {
    const char * const       codes[] = { "sk" };
    uint8_t                  buffer[CW_MAX_HEADER_BYTES];
    struct cw_request_header header;
    const size_t             size = langid_frame(buffer, codes, 1, 1);
    memset(buffer + size, 0, sizeof buffer - size);
    CHECK(cw_parse_header(buffer, sizeof buffer, &header) == CW_PARSE_INVALID);
}

int main(void) {
    accepts_the_whitelisted_languages();
    rejects_other_languages_and_embedded_nul();
    bounds_the_sample_count();
    reports_incomplete_headers();
    decodes_little_endian_pcm16();
    parses_extended_vocabulary_without_leaking_into_legacy_requests();
    parses_a_langid_header();
    bounds_the_allowed_count();
    rejects_invalid_langid_codes();
    bounds_the_langid_sample_count();
    reports_incomplete_langid_headers();
    legacy_parser_still_rejects_the_langid_tag();
    if (failures > 0) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("request parser: all checks passed\n");
    return 0;
}
