function dithering(ctx, width, height, threshold) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.floor(
      data[index] * 0.299
      + data[index + 1] * 0.587
      + data[index + 2] * 0.114,
    );
    const value = luminance < threshold ? 0 : 255;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
}
