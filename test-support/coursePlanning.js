import { getCourseById } from "../src/data/courses.js";
import { createSpawnBall, getDistanceToHole, simulateSwing } from "../src/lib/physics.js";

const SEARCH_ANGLE_STEP_DEGREES = 10;
const SEARCH_POWERS = [0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84, 0.92, 1];
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_BEAM_WIDTH = 60;
const sinkPlanCache = new Map();

function buildSwingCandidates() {
  const swings = [];

  for (let degrees = -180; degrees < 180; degrees += SEARCH_ANGLE_STEP_DEGREES) {
    const angle = (degrees * Math.PI) / 180;
    SEARCH_POWERS.forEach((power) => {
      swings.push({ angle, power });
    });
  }

  return swings;
}

const SWING_CANDIDATES = buildSwingCandidates();

function resolveCourse(courseOrId) {
  return typeof courseOrId === "string" ? getCourseById(courseOrId) : courseOrId;
}

function getBallStateKey(ball) {
  return `${Math.round(ball.x)}:${Math.round(ball.y)}:${ball.sunk ? 1 : 0}`;
}

function getNodeScore(course, ball, strokes) {
  return getDistanceToHole(course, ball) + strokes * 40;
}

function computeCourseSinkPlan(course, { maxDepth = DEFAULT_MAX_DEPTH, beamWidth = DEFAULT_BEAM_WIDTH } = {}) {
  const startingBall = createSpawnBall(course);
  let frontier = [
    {
      ball: startingBall,
      path: [],
      score: getNodeScore(course, startingBall, 0)
    }
  ];
  const visitedDepthByBallState = new Map([[getBallStateKey(startingBall), 0]]);

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const nextFrontier = [];

    for (const node of frontier) {
      for (const swing of SWING_CANDIDATES) {
        const result = simulateSwing({
          course,
          ball: node.ball,
          angle: swing.angle,
          power: swing.power
        });
        const path = [...node.path, swing];

        if (result.ball.sunk) {
          return path;
        }

        const ballStateKey = getBallStateKey(result.ball);
        const previousDepth = visitedDepthByBallState.get(ballStateKey);
        if (previousDepth !== undefined && previousDepth <= path.length) {
          continue;
        }

        visitedDepthByBallState.set(ballStateKey, path.length);
        nextFrontier.push({
          ball: result.ball,
          path,
          score: getNodeScore(course, result.ball, path.length)
        });
      }
    }

    nextFrontier.sort((left, right) => left.score - right.score);
    frontier = nextFrontier.slice(0, beamWidth);
    if (!frontier.length) {
      break;
    }
  }

  return null;
}

export function findCourseSinkPlan(courseOrId, options = undefined) {
  const course = resolveCourse(courseOrId);
  const cacheKey = options ? null : course.id;

  if (cacheKey && sinkPlanCache.has(cacheKey)) {
    return sinkPlanCache.get(cacheKey);
  }

  const plan = computeCourseSinkPlan(course, options);
  if (cacheKey) {
    sinkPlanCache.set(cacheKey, plan);
  }

  return plan;
}
