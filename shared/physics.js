export const BALL_RADIUS = 10;
export const BASE_FRICTION = 0.992;
export const SAND_FRICTION = 0.950;
export const WALL_RESTITUTION = 0.84;
export const STOP_SPEED = 7;
export const MAX_SPEED = 920;
export const SIMULATION_STEPS = 2600;
export const TIME_STEP = 1 / 120;
export const SPEED_BOOST_ACCELERATION = {
  1: 110,
  2: 190,
  3: 285
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getRectAngleRadians(rect) {
  return ((Number(rect?.angle) || 0) * Math.PI) / 180;
}

function worldToRectSpace(point, rect) {
  const angle = getRectAngleRadians(rect);
  const dx = point.x - rect.x;
  const dy = point.y - rect.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos
  };
}

function rectToWorldSpace(point, rect) {
  const angle = getRectAngleRadians(rect);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: rect.x + point.x * cos - point.y * sin,
    y: rect.y + point.x * sin + point.y * cos
  };
}

function vectorRectToWorld(vector, rect) {
  const angle = getRectAngleRadians(rect);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function isInsideRect(point, rect) {
  const localPoint = worldToRectSpace(point, rect);
  return (
    localPoint.x >= 0 &&
    localPoint.x <= rect.width &&
    localPoint.y >= 0 &&
    localPoint.y <= rect.height
  );
}

function getCourseRects(course, fieldName, legacyFieldName = null) {
  if (Array.isArray(course?.[fieldName])) {
    return course[fieldName];
  }

  if (legacyFieldName && Array.isArray(course?.[legacyFieldName])) {
    return course[legacyFieldName];
  }

  return [];
}

function resolveBoundaryCollision(state, course) {
  if (state.x - BALL_RADIUS < 0) {
    state.x = BALL_RADIUS;
    state.vx = Math.abs(state.vx) * WALL_RESTITUTION;
  }

  if (state.x + BALL_RADIUS > course.width) {
    state.x = course.width - BALL_RADIUS;
    state.vx = -Math.abs(state.vx) * WALL_RESTITUTION;
  }

  if (state.y - BALL_RADIUS < 0) {
    state.y = BALL_RADIUS;
    state.vy = Math.abs(state.vy) * WALL_RESTITUTION;
  }

  if (state.y + BALL_RADIUS > course.height) {
    state.y = course.height - BALL_RADIUS;
    state.vy = -Math.abs(state.vy) * WALL_RESTITUTION;
  }
}

function resolveRectCollision(state, rect) {
  const localBall = worldToRectSpace(state, rect);
  const closestX = clamp(localBall.x, 0, rect.width);
  const closestY = clamp(localBall.y, 0, rect.height);
  const deltaX = localBall.x - closestX;
  const deltaY = localBall.y - closestY;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY;

  if (distanceSquared >= BALL_RADIUS * BALL_RADIUS) {
    return;
  }

  if (distanceSquared === 0) {
    const distances = [
      { axis: "left", amount: Math.abs(localBall.x) },
      { axis: "right", amount: Math.abs(rect.width - localBall.x) },
      { axis: "top", amount: Math.abs(localBall.y) },
      { axis: "bottom", amount: Math.abs(rect.height - localBall.y) }
    ];
    const nearest = distances.sort((a, b) => a.amount - b.amount)[0];
    let resolvedBall = localBall;
    let normalLocal = { x: 0, y: 0 };

    if (nearest.axis === "left") {
      resolvedBall = { x: -BALL_RADIUS, y: localBall.y };
      normalLocal = { x: -1, y: 0 };
    } else if (nearest.axis === "right") {
      resolvedBall = { x: rect.width + BALL_RADIUS, y: localBall.y };
      normalLocal = { x: 1, y: 0 };
    } else if (nearest.axis === "top") {
      resolvedBall = { x: localBall.x, y: -BALL_RADIUS };
      normalLocal = { x: 0, y: -1 };
    } else {
      resolvedBall = { x: localBall.x, y: rect.height + BALL_RADIUS };
      normalLocal = { x: 0, y: 1 };
    }

    const resolvedWorld = rectToWorldSpace(resolvedBall, rect);
    const normalWorld = vectorRectToWorld(normalLocal, rect);
    const velocityDot = state.vx * normalWorld.x + state.vy * normalWorld.y;
    state.x = resolvedWorld.x;
    state.y = resolvedWorld.y;
    if (velocityDot < 0) {
      state.vx -= (1 + WALL_RESTITUTION) * velocityDot * normalWorld.x;
      state.vy -= (1 + WALL_RESTITUTION) * velocityDot * normalWorld.y;
    }

    return;
  }

  const collisionDistance = Math.sqrt(distanceSquared);
  const normalLocal = {
    x: deltaX / collisionDistance,
    y: deltaY / collisionDistance
  };
  const overlap = BALL_RADIUS - collisionDistance;
  const resolvedBall = {
    x: localBall.x + normalLocal.x * overlap,
    y: localBall.y + normalLocal.y * overlap
  };
  const resolvedWorld = rectToWorldSpace(resolvedBall, rect);
  const normalWorld = vectorRectToWorld(normalLocal, rect);
  const velocityDot = state.vx * normalWorld.x + state.vy * normalWorld.y;

  state.x = resolvedWorld.x;
  state.y = resolvedWorld.y;
  if (velocityDot < 0) {
    state.vx -= (1 + WALL_RESTITUTION) * velocityDot * normalWorld.x;
    state.vy -= (1 + WALL_RESTITUTION) * velocityDot * normalWorld.y;
  }
}

function maybeSinkBall(state, course) {
  const speed = Math.hypot(state.vx, state.vy);
  const holeDistance = distance(state, course.hole);

  if (holeDistance <= course.hole.radius && speed <= 180) {
    state.x = course.hole.x;
    state.y = course.hole.y;
    state.vx = 0;
    state.vy = 0;
    state.sunk = true;
    return true;
  }

  return false;
}

export function createSpawnBall(course) {
  return {
    x: course.tee.x,
    y: course.tee.y,
    sunk: false
  };
}

export function getBallRadius() {
  return BALL_RADIUS;
}

export function getDistanceToHole(course, ball) {
  return Number(distance(ball, course.hole).toFixed(1));
}

export function getProgressPercent(course, ball) {
  const teeDistance = distance(course.tee, course.hole);
  const ballDistance = distance(ball, course.hole);
  const progress = teeDistance === 0 ? 100 : ((teeDistance - ballDistance) / teeDistance) * 100;
  return clamp(Math.round(progress), 0, 100);
}

export function simulateSwing({ course, ball, angle, power }) {
  const boundedPower = clamp(Number(power) || 0, 0.05, 1);
  const walls = getCourseRects(course, "walls");
  const sandTraps = getCourseRects(course, "sandTraps");
  const waterHazards = getCourseRects(course, "waterHazards", "water");
  const speedBoosts = getCourseRects(course, "speedBoosts");
  const state = {
    x: ball.x,
    y: ball.y,
    vx: Math.cos(angle) * MAX_SPEED * boundedPower,
    vy: Math.sin(angle) * MAX_SPEED * boundedPower,
    sunk: false
  };
  const path = [{ x: state.x, y: state.y }];

  for (let step = 0; step < SIMULATION_STEPS; step += 1) {
    state.x += state.vx * TIME_STEP;
    state.y += state.vy * TIME_STEP;

    resolveBoundaryCollision(state, course);
    walls.forEach((wall) => resolveRectCollision(state, wall));

    if (maybeSinkBall(state, course)) {
      path.push({ x: state.x, y: state.y });
      break;
    }

    if (waterHazards.some((hazard) => isInsideRect(state, hazard))) {
      path.push({ x: Number(state.x.toFixed(2)), y: Number(state.y.toFixed(2)) });
      path.push({ x: Number(ball.x.toFixed(2)), y: Number(ball.y.toFixed(2)) });

      return {
        path,
        ball: {
          x: Number(ball.x.toFixed(2)),
          y: Number(ball.y.toFixed(2)),
          sunk: false
        },
        hazard: "water"
      };
    }

    const activeBoost = speedBoosts.find((boost) => isInsideRect(state, boost));
    if (activeBoost) {
      const boostAcceleration =
        SPEED_BOOST_ACCELERATION[Math.min(3, Math.max(1, Math.round(Number(activeBoost.strength) || 1)))] ??
        SPEED_BOOST_ACCELERATION[1];
      const boostAngle = getRectAngleRadians(activeBoost);
      state.vx += Math.cos(boostAngle) * boostAcceleration * TIME_STEP;
      state.vy += Math.sin(boostAngle) * boostAcceleration * TIME_STEP;
    }

    const friction = sandTraps.some((trap) => isInsideRect(state, trap))
      ? SAND_FRICTION
      : BASE_FRICTION;

    state.vx *= friction;
    state.vy *= friction;

    if (step % 4 === 0) {
      path.push({ x: Number(state.x.toFixed(2)), y: Number(state.y.toFixed(2)) });
    }

    if (!activeBoost && Math.hypot(state.vx, state.vy) <= STOP_SPEED) {
      break;
    }
  }

  return {
    path,
    ball: {
      x: Number(state.x.toFixed(2)),
      y: Number(state.y.toFixed(2)),
      sunk: state.sunk
    },
    hazard: null
  };
}
