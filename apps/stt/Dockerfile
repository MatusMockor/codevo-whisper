FROM debian:trixie-slim AS engine
ARG TRANSCRIBE_COMMIT=8facde6fcd8fb9caa585a5788ab450df6e8ec7db
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git cmake ninja-build g++ libvulkan-dev glslc spirv-headers libopenblas-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init --quiet transcribe.cpp \
  && git -C transcribe.cpp remote add origin https://github.com/handy-computer/transcribe.cpp.git \
  && git -C transcribe.cpp fetch --quiet --depth 1 origin "${TRANSCRIBE_COMMIT}" \
  && git -C transcribe.cpp checkout --quiet FETCH_HEAD \
  && test "$(git -C transcribe.cpp rev-parse HEAD)" = "${TRANSCRIBE_COMMIT}"
RUN cmake -S transcribe.cpp -B build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DTRANSCRIBE_VULKAN=ON \
    -DTRANSCRIBE_BUILD_TESTS=OFF \
    -DGGML_NATIVE=OFF \
    -DBUILD_SHARED_LIBS=OFF \
  && cmake --build build --target transcribe-cli \
  && install -D -m 0755 build/bin/transcribe-cli /opt/transcribe/bin/transcribe-cli

FROM node:24-trixie-slim AS app
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY scripts ./scripts
COPY packages/stt-runner ./packages/stt-runner
COPY apps/stt ./apps/stt
RUN pnpm install --frozen-lockfile --filter "@codevo-whisper/stt..." --filter codevo-whisper
RUN pnpm --filter @codevo-whisper/stt build

FROM node:24-trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libvulkan1 mesa-vulkan-drivers libopenblas0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=engine /opt/transcribe /opt/transcribe
RUN if ldd /opt/transcribe/bin/transcribe-cli | grep -q 'not found'; then ldd /opt/transcribe/bin/transcribe-cli; exit 1; fi
WORKDIR /app
COPY --from=app /repo/apps/stt/dist ./dist
RUN mkdir -p /models && chown node:node /models
ENV NODE_ENV=production \
  STT_BINARY=/opt/transcribe/bin/transcribe-cli \
  STT_MODEL_PATH=/models/parakeet-ultra-F16.gguf \
  STT_BACKEND=vulkan \
  STT_THREADS=4 \
  STT_PORT=8001
USER node
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8001/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
