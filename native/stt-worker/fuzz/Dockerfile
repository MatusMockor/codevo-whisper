FROM debian:trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends clang libclang-rt-dev python3 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /fuzz
COPY stt-worker-request.c stt-worker-request.h ./src/
COPY fuzz/request-fuzzer.c fuzz/make-corpus.py ./src/fuzz/
RUN clang -std=c11 -g -O1 -fsanitize=fuzzer,address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer \
    src/stt-worker-request.c src/fuzz/request-fuzzer.c -o request-fuzzer \
  && python3 src/fuzz/make-corpus.py seeds
ENTRYPOINT ["/fuzz/request-fuzzer"]
