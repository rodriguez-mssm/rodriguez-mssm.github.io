import { LABEL_CONFIG } from "./label-config.js?v=202609070003";

export function labelCapacity(config = LABEL_CONFIG) {
  return config.grid.rows * config.grid.columns;
}

export function positionToGrid(position, config = LABEL_CONFIG) {
  const capacity = labelCapacity(config);
  if (!Number.isInteger(position) || position < 1 || position > capacity) throw new Error(`Start position must be between 1 and ${capacity}`);
  const zeroBased = position - 1;
  return { position, row: Math.floor(zeroBased / config.grid.columns) + 1, column: zeroBased % config.grid.columns + 1 };
}

export function coordinateForPosition(position, config = LABEL_CONFIG) {
  const grid = positionToGrid(position, config);
  return {
    ...grid,
    xMm: config.margins.leftMm + (grid.column - 1) * (config.label.widthMm + config.gaps.horizontalMm),
    yMm: config.margins.topMm + (grid.row - 1) * (config.label.heightMm + config.gaps.verticalMm),
  };
}

export function planLabelPositions(labelCount, options = {}, config = LABEL_CONFIG) {
  if (!Number.isInteger(labelCount) || labelCount < 1) throw new Error("Label count must be a positive integer");
  const capacity = labelCapacity(config);
  const startPosition = options.startPosition ?? 1;
  positionToGrid(startPosition, config);
  const remainingOnFirstPage = capacity - startPosition + 1;
  if (!options.multiPage && labelCount > remainingOnFirstPage) {
    throw new Error(`${labelCount} labels do not fit from position ${startPosition}; only ${remainingOnFirstPage} positions remain`);
  }
  return Array.from({ length: labelCount }, (_, index) => {
    const absolutePosition = startPosition - 1 + index;
    const pageIndex = Math.floor(absolutePosition / capacity);
    const position = absolutePosition % capacity + 1;
    return { pageIndex, ...coordinateForPosition(position, config) };
  });
}

export function assertCoordinatesWithinPage(config = LABEL_CONFIG) {
  for (let position = 1; position <= labelCapacity(config); position += 1) {
    const { xMm, yMm } = coordinateForPosition(position, config);
    if (xMm < 0 || yMm < 0 || xMm + config.label.widthMm > config.page.widthMm || yMm + config.label.heightMm > config.page.heightMm) {
      throw new Error(`Label position ${position} exceeds the physical page`);
    }
  }
  return true;
}
