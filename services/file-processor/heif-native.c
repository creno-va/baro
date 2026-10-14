/* Bounded HEIC primary-image decoder. No source metadata or native error text
 * leaves this process. Built against pinned libheif 1.23.6/libde265 1.1.3. */
#include <libheif/heif.h>
#include <libheif/heif_sequences.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

#define MAX_PIXELS UINT64_C(40000000)
#define MAX_BYTES 100000000
#define MAX_MEMORY UINT64_C(536870912)

static uint64_t tighten(uint64_t original, uint64_t limit) {
  return original && original < limit ? original : limit;
}

static int dimensions(int width, int height) {
  return width > 0 && height > 0 && (uint64_t)width * height <= MAX_PIXELS;
}

int main(int argc, char **argv) {
  int result = 1;
  int created_output = 0;
  int decode = argc == 4 && strcmp(argv[1], "decode") == 0;
  int probe = argc == 3 && strcmp(argv[1], "probe") == 0;
  heif_context *ctx = NULL;
  heif_image_handle *handle = NULL;
  heif_image *image = NULL;
  heif_decoding_options *options = NULL;
  FILE *output = NULL;
  struct stat source;
  /* Supplement the parent's whole-job deadline. No network or shell commands. */
  struct rlimit address_space = {805306368, 805306368};
  struct rlimit cpu = {60, 60};
  if ((!decode && !probe) || setrlimit(RLIMIT_AS, &address_space) ||
      setrlimit(RLIMIT_CPU, &cpu) || stat(argv[2], &source) ||
      !S_ISREG(source.st_mode) || source.st_size < 1 || source.st_size > MAX_BYTES)
    return 1;
  if (strcmp(heif_get_version(), "1.23.6") != 0 || heif_init(NULL).code)
    return 1;
  ctx = heif_context_alloc();
  if (!ctx) goto cleanup;
  heif_security_limits *limits = heif_context_get_security_limits(ctx);
  if (!limits || limits->version < 4) goto cleanup;
  /* Retain every default parser limit; only tighten these resource ceilings. */
  limits->max_image_size_pixels = tighten(limits->max_image_size_pixels, MAX_PIXELS);
  limits->max_memory_block_size = tighten(limits->max_memory_block_size, MAX_MEMORY);
  limits->max_total_memory = tighten(limits->max_total_memory, MAX_MEMORY);
  heif_context_set_max_decoding_threads(ctx, 0);
  if (heif_context_read_from_file(ctx, argv[2], NULL).code) goto cleanup;
  int count = heif_context_get_number_of_top_level_images(ctx);
  int tracks = heif_context_number_of_sequence_tracks(ctx);
  if (count < 1 || tracks < 0 ||
      (limits->max_items && (unsigned)count > limits->max_items)) goto cleanup;
  if (heif_context_get_primary_image_handle(ctx, &handle).code || !handle) goto cleanup;
  int width = heif_image_handle_get_width(handle);
  int height = heif_image_handle_get_height(handle);
  if (!dimensions(width, height)) goto cleanup;
  if (decode) {
    options = heif_decoding_options_alloc();
    if (!options || options->version < 8) goto cleanup;
    options->strict_decoding = 1;
    options->convert_hdr_to_8bit = 1;
    options->decoder_id = "libde265";
    options->num_codec_threads = 1;
    if (heif_decode_image(handle, &image, heif_colorspace_RGB,
                          heif_chroma_interleaved_RGBA, options).code || !image)
      goto cleanup;
    /* Never use handle dimensions/stride to index decoded pixels. */
    int decoded_width = heif_image_get_primary_width(image);
    int decoded_height = heif_image_get_primary_height(image);
    if (!dimensions(decoded_width, decoded_height) || decoded_width != width ||
        decoded_height != height ||
        heif_image_get_bits_per_pixel_range(image, heif_channel_interleaved) != 8 ||
        heif_image_get_bits_per_pixel(image, heif_channel_interleaved) != 32)
      goto cleanup;
    size_t stride = 0;
    const uint8_t *plane = heif_image_get_plane_readonly2(image, heif_channel_interleaved, &stride);
    size_t row_bytes = (size_t)width * 4;
    if (!plane || stride < row_bytes || stride > MAX_MEMORY / (size_t)height) goto cleanup;
    int descriptor = open(argv[3], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (descriptor < 0) goto cleanup;
    created_output = 1;
    output = fdopen(descriptor, "wb");
    if (!output) { close(descriptor); goto cleanup; }
    if (fprintf(output, "P6\n%d %d\n255\n", width, height) < 0) goto cleanup;
    uint8_t *row = malloc((size_t)width * 3);
    if (!row) goto cleanup;
    int premultiplied = heif_image_is_premultiplied_alpha(image);
    int failed = 0;
    for (int y = 0; y < height && !failed; y++) {
      const uint8_t *input = plane + stride * (size_t)y;
      for (int x = 0; x < width; x++) {
        unsigned alpha = input[(size_t)x * 4 + 3];
        for (int c = 0; c < 3; c++) {
          unsigned channel = input[(size_t)x * 4 + c];
          unsigned flattened = premultiplied ? channel + 255 - alpha :
            (channel * alpha + 255 * (255 - alpha) + 127) / 255;
          row[(size_t)x * 3 + c] = (uint8_t)(flattened > 255 ? 255 : flattened);
        }
      }
      failed = fwrite(row, 3, (size_t)width, output) != (size_t)width;
    }
    free(row);
    if (failed || fflush(output)) goto cleanup;
    if (fclose(output)) { output = NULL; goto cleanup; }
    output = NULL;
  }
  /* Only bounded integer metadata is emitted; errors produce no payload. */
  if (printf("{\"width\":%d,\"height\":%d,\"multiFrame\":%s}\n",
             width, height, count > 1 || tracks > 0 ? "true" : "false") < 0) goto cleanup;
  result = 0;
cleanup:
  if (output) fclose(output);
  if (options) heif_decoding_options_free(options);
  if (image) heif_image_release(image);
  if (handle) heif_image_handle_release(handle);
  if (ctx) heif_context_free(ctx);
  heif_deinit();
  if (result && created_output) unlink(argv[3]);
  return result;
}
