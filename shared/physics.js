export const BALL_RADIUS = 10;
export const BASE_FRICTION = 0.992;
export const SAND_FRICTION = 0.950;
export const WALL_RESTITUTION = 0.84;
export const STOP_SPEED = 7;
export const MAX_SPEED = 920;
export const SIMULATION_STEPS = 2600;
export const TIME_STEP = 1 / 120;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isInsideRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
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
  const closestX = clamp(state.x, rect.x, rect.x + rect.width);
  const closestY = clamp(state.y, rect.y, rect.y + rect.height);
  const deltaX = state.x - closestX;
  const deltaY = state.y - closestY;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY;

  if (distanceSquared >= BALL_RADIUS * BALL_RADIUS) {
    return;
  }

  if (distanceSquared === 0) {
    const distances = [
      { axis: "left", amount: Math.abs(state.x - rect.x) },
      { axis: "right", amount: Math.abs(rect.x + rect.width - state.x) },
      { axis: "top", amount: Math.abs(state.y - rect.y) },
      { axis: "bottom", amount: Math.abs(rect.y + rect.height - state.y) }
    ];
    const nearest = distances.sort((a, b) => a.amount - b.amount)[0];

    if (nearest.axis === "left") {
      state.x = rect.x - BALL_RADIUS;
      state.vx = -Math.abs(state.vx) * WALL_RESTITUTION;
    } else if (nearest.axis === "right") {
      state.x = rect.x + rect.width + BALL_RADIUS;
      state.vx = Math.abs(state.vx) * WALL_RESTITUTION;
    } else if (nearest.axis === "top") {
      state.y = rect.y - BALL_RADIUS;
      state.vy = -Math.abs(state.vy) * WALL_RESTITUTION;
    } else {
      state.y = rect.y + rect.height + BALL_RADIUS;
      state.vy = Math.abs(state.vy) * WALL_RESTITUTION;
    }

    return;
  }

  const collisionDistance = Math.sqrt(distanceSquared);
  const normalX = deltaX / collisionDistance;
  const normalY = deltaY / collisionDistance;
  const overlap = BALL_RADIUS - collisionDistance;

  state.x += normalX * overlap;
  state.y += normalY * overlap;

  if (Math.abs(normalX) > Math.abs(normalY)) {
    state.vx = -state.vx * WALL_RESTITUTION;
  } else {
    state.vy = -state.vy * WALL_RESTITUTION;
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

    const friction = sandTraps.some((trap) => isInsideRect(state, trap))
      ? SAND_FRICTION
      : BASE_FRICTION;

    state.vx *= friction;
    state.vy *= friction;

    if (step % 4 === 0) {
      path.push({ x: Number(state.x.toFixed(2)), y: Number(state.y.toFixed(2)) });
    }

    if (Math.hypot(state.vx, state.vy) <= STOP_SPEED) {
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
