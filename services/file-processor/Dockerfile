# Prefix the existing pinned product FROM with this independent build stage.
FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS heif-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSLo de265.tar.gz https://github.com/strukturag/libde265/releases/download/v1.1.3/libde265-1.1.3.tar.gz \
    && echo '554228bd17788c99a7e63b37ab5634722190e6e2bf60c1dcb01cef328e133905  de265.tar.gz' | sha256sum -c - \
    && tar -xzf de265.tar.gz \
    && cmake -S libde265-1.1.3 -B de265-build -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/baro-heif -DCMAKE_INSTALL_LIBDIR=lib \
      -DCMAKE_INSTALL_RPATH=/opt/baro-heif/lib -DENABLE_SDL=OFF \
      -DENABLE_DECODER=OFF -DENABLE_ENCODER=OFF -DBUILD_SHARED_LIBS=ON \
    && cmake --build de265-build --parallel 2 && cmake --install de265-build
RUN curl -fsSLo heif.tar.gz https://github.com/strukturag/libheif/releases/download/v1.23.6/libheif-1.23.6.tar.gz \
    && echo '4484346dc5995319dbc11e3a1c35d0a2ec46511ce370900869337fd2c7033125  heif.tar.gz' | sha256sum -c - \
    && tar -xzf heif.tar.gz \
    && PKG_CONFIG_PATH=/opt/baro-heif/lib/pkgconfig cmake -S libheif-1.23.6 -B heif-build \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/baro-heif \
      -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_INSTALL_RPATH=/opt/baro-heif/lib \
      -DBUILD_SHARED_LIBS=ON -DBUILD_TESTING=OFF -DWITH_EXAMPLES=OFF -DWITH_GDK_PIXBUF=OFF \
      -DENABLE_PLUGIN_LOADING=OFF -DENABLE_PARALLEL_TILE_DECODING=OFF \
      -DWITH_LIBDE265=ON -DWITH_LIBDE265_PLUGIN=OFF \
      -DWITH_X265=OFF -DWITH_X264=OFF -DWITH_OpenH264_DECODER=OFF \
      -DWITH_AOM_DECODER=OFF -DWITH_AOM_ENCODER=OFF -DWITH_DAV1D=OFF \
      -DWITH_FFMPEG_DECODER=OFF -DWITH_LIBSHARPYUV=OFF -DWITH_UNCOMPRESSED_CODEC=OFF \
    && cmake --build heif-build --parallel 1 && cmake --install heif-build
COPY services/file-processor/heif-native.c /build/heif-native.c
RUN cc -std=c11 -D_POSIX_C_SOURCE=200809L -O2 -Wall -Wextra -Werror \
    /build/heif-native.c -I/opt/baro-heif/include -L/opt/baro-heif/lib \
    -Wl,-rpath,/opt/baro-heif/lib -lheif -o /build/heif-native \
    && mkdir -p /opt/baro-heif/licenses \
    && cp /build/libheif-1.23.6/COPYING /opt/baro-heif/licenses/libheif-COPYING \
    && cp /build/libde265-1.1.3/COPYING /opt/baro-heif/licenses/libde265-COPYING


FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS office-runtime
# Native tools stay in this standalone service, never the Workers bundle.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pil ffmpeg poppler-utils tesseract-ocr tesseract-ocr-kor \
    libreoffice-writer=4:25.2.3-2+deb13u8 libreoffice-calc=4:25.2.3-2+deb13u8 \
    libreoffice-impress=4:25.2.3-2+deb13u8 libreoffice-java-common=4:25.2.3-2+deb13u8 \
    python3-uno=4:25.2.3-2+deb13u8 python3-olefile=0.47-1 \
    fonts-noto-cjk=1:20240730+repack1-1 default-jre-headless=2:1.21-76 \
    && rm -rf /var/lib/apt/lists/*

FROM office-runtime AS hwp-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl default-jdk-headless=2:1.21-76 unzip zip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Official release bytes and corresponding tagged source, both immutable pins.
RUN curl -fLsS https://github.com/ebandal/H2Orestart/releases/download/v0.7.14/H2Orestart.oxt -o original.oxt \
    && echo 'cbea23bc37861361bbc534bc0675e5bc67b36f712072490f82a9bf410d7c04d8  original.oxt' | sha256sum -c - \
    && curl -fLsS https://codeload.github.com/ebandal/H2Orestart/tar.gz/refs/tags/v0.7.14 -o source.tar.gz \
    && echo 'a73246fdfd00e7f7f69915e577b8d3e602113087cbed1c1e1ebba3087fde6a15  source.tar.gz' | sha256sum -c - \
    && tar -xzf source.tar.gz && mkdir extension classes && unzip -q original.oxt -d extension
COPY services/file-processor/build-hwp.py /build/build-hwp.py
RUN python3 build-hwp.py H2Orestart-0.7.14 \
    && javac -encoding UTF-8 -cp '/usr/share/java/*:extension/H2Orestart.jar' -d classes \
       H2Orestart-0.7.14/source/ebandal/libreoffice/comp/H2OrestartImpl.java \
       H2Orestart-0.7.14/source/HwpDoc/HwpxFile.java \
    && jar uf extension/H2Orestart.jar -C classes . \
    && printf '.level=OFF\nhandlers=\n' > extension/logger.properties \
    && cd extension && zip -qr /build/H2Orestart-private.oxt .

FROM office-runtime
COPY --from=heif-build /opt/baro-heif/lib /opt/baro-heif/lib
COPY --from=heif-build /opt/baro-heif/licenses /opt/baro-heif/licenses
COPY --from=heif-build /build/heif-native /app/heif-native
COPY --from=hwp-build /build/H2Orestart-private.oxt /opt/baro/H2Orestart-private.oxt
COPY --from=hwp-build /build/H2Orestart-0.7.14 /usr/share/doc/baro-h2orestart-source
# The non-root runtime receives this installed, offline extension. All writable
# profiles/caches later live in the current private job directory.
RUN /usr/lib/libreoffice/program/unopkg add --shared --suppress-license /opt/baro/H2Orestart-private.oxt \
    && rm /opt/baro/H2Orestart-private.oxt
WORKDIR /app
COPY services/file-processor/server.mjs services/file-processor/processor.py \
    services/file-processor/office.py services/file-processor/office-convert.py \
    services/file-processor/heif.py ./
USER node
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["node", "server.mjs"]
