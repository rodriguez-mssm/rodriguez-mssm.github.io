export function blackPixelRuns(rgba, width, height) {
  const runs = [];
  for (let y = 0; y < height; y += 1) {
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      const index = (y * width + x) * 4;
      const black = x < width && rgba[index + 3] > 0 && rgba[index] < 128 && rgba[index + 1] < 128 && rgba[index + 2] < 128;
      if (black && start < 0) start = x;
      if (!black && start >= 0) {
        runs.push({ y, startX: start, length: x - start });
        start = -1;
      }
    }
  }
  return runs;
}
