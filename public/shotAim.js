function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createDragAim(ball, pointerId) {
  return {
    pointerId,
    start: {
      x: Number(ball.x),
      y: Number(ball.y)
    },
    current: {
      x: Number(ball.x),
      y: Number(ball.y)
    }
  };
}

export function getShotFromDrag(startPoint, currentPoint, { minDistance, powerDistance, minPower = 0.05, maxPower = 1 }) {
  const dx = currentPoint.x - startPoint.x;
  const dy = currentPoint.y - startPoint.y;
  const distance = Math.hypot(dx, dy);

  if (distance < minDistance) {
    return null;
  }

  return {
    angle: Math.atan2(startPoint.y - currentPoint.y, startPoint.x - currentPoint.x),
    power: clamp(distance / powerDistance, minPower, maxPower)
  };
}
