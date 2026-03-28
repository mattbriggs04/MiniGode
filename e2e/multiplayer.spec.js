import { expect, test } from "@playwright/test";
import { getCourseById, getCourseSummaries } from "../src/data/courses.js";
import { createSpawnBall, simulateSwing } from "../src/lib/physics.js";
import { findCourseSinkPlan } from "../test-support/coursePlanning.js";

test.describe.configure({ mode: "serial" });

const COURSE_SUMMARIES = getCourseSummaries();
const DEFAULT_COURSE = COURSE_SUMMARIES[0];

function requireCourseSummaries(count) {
  expect(COURSE_SUMMARIES.length).toBeGreaterThanOrEqual(count);
  return COURSE_SUMMARIES.slice(0, count);
}

async function createRoom(page, {
  name,
  difficultyMode = "fixed",
  difficulty = "easy",
  questionSource = "local",
  courseCount = 1,
  courseId = DEFAULT_COURSE?.id,
  courseIds = null
}) {
  const orderedCourseIds = courseIds ?? (courseId ? [courseId] : null);
  const resolvedCourseCount = orderedCourseIds?.length ?? courseCount;

  await page.goto("/");
  await page.locator('#landing-tab-create').click();
  await page.locator('#create-form input[name="name"]').fill(name);
  await page.locator("#create-difficulty-mode").selectOption(difficultyMode);
  if (difficultyMode === "fixed") {
    await page.locator("#create-difficulty").selectOption(difficulty);
  }
  await page.locator("#create-question-source").selectOption(questionSource);
  await page.locator("#create-course-count").selectOption(String(resolvedCourseCount));

  if (orderedCourseIds) {
    await page.locator("#create-advanced-settings summary").click();
    for (const [index, selectedCourseId] of orderedCourseIds.entries()) {
      await page.locator(`#create-course-order-fields select[data-course-order-index="${index}"]`).selectOption(selectedCourseId);
    }
  }

  await page.locator('#create-form button[type="submit"]').click();
  await expect(page.locator("#waiting-view")).toBeVisible();

  const roomCode = (await page.locator("#waiting-room-code").textContent())?.trim();
  if (!roomCode) {
    throw new Error("Expected room code after creating a room.");
  }

  return roomCode;
}

async function joinRoom(page, { roomCode, name }) {
  await page.goto("/");
  await page.locator('#landing-tab-join').click();
  await page.locator('#join-form input[name="name"]').fill(name);
  await page.locator('#join-form input[name="roomCode"]').fill(roomCode);
  await page.locator('#join-form button[type="submit"]').click();
  await expect(page.locator("#waiting-view")).toBeVisible();
}

async function openChat(page) {
  const chatPanel = page.locator("#chat-panel");
  if (await chatPanel.isHidden()) {
    await page.locator("#chat-toggle-btn").click();
  }

  await expect(chatPanel).toBeVisible();
}

function worldToScreen(box, course, point) {
  return {
    x: box.x + (point.x / course.width) * box.width,
    y: box.y + (point.y / course.height) * box.height
  };
}

async function playCourseSinkPlan(page, courseId) {
  const course = getCourseById(courseId);
  const swings = findCourseSinkPlan(courseId);
  expect(swings?.length).toBeTruthy();
  let ball = createSpawnBall(course);

  for (const swing of swings) {
    const canvas = page.locator("#course-canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Expected course canvas bounds.");
    }

    const dragDistance = 260 * swing.power;
    const startPoint = worldToScreen(box, course, ball);
    const endPoint = worldToScreen(box, course, {
      x: ball.x - Math.cos(swing.angle) * dragDistance,
      y: ball.y - Math.sin(swing.angle) * dragDistance
    });

    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    await page.mouse.move(endPoint.x, endPoint.y, { steps: 8 });
    await page.mouse.up();
    await page.locator("#swing-btn").click();

    const simulation = simulateSwing({
      course,
      ball,
      angle: swing.angle,
      power: swing.power
    });
    ball = simulation.ball;
    await page.waitForTimeout(Math.max(800, simulation.path.length * 24) + 200);
  }
}

test("guest refresh restores the room session and end-vote counts stay synced", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    const roomCode = await createRoom(hostPage, { name: "Host" });
    await joinRoom(guestPage, { roomCode, name: "Guest" });

    await expect(hostPage.locator("#waiting-player-list")).toContainText("Guest");

    await guestPage.reload();
    await expect(guestPage.locator("#waiting-view")).toBeVisible();
    await expect(guestPage.locator("#waiting-room-code")).toHaveText(roomCode);

    await openChat(hostPage);
    await openChat(guestPage);

    await expect(hostPage.locator("#chat-end-btn")).toHaveText("End game (0/2)");
    await expect(guestPage.locator("#chat-end-btn")).toHaveText("End game (0/2)");

    await hostPage.locator("#chat-end-btn").click();
    await expect(hostPage.locator("#chat-end-btn")).toHaveText("Cancel end vote (1/2)");
    await expect(guestPage.locator("#chat-end-btn")).toHaveText("End game (1/2)");
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});

test("multi-course progression stays viewer-specific after the host clears course one", async ({ browser }) => {
  const [firstCourse, secondCourse] = requireCourseSummaries(2);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    const roomCode = await createRoom(hostPage, {
      name: "dev$mode!",
      courseIds: [firstCourse.id, secondCourse.id]
    });
    await joinRoom(guestPage, { roomCode, name: "Guest" });

    await expect(hostPage.locator("#waiting-player-list")).toContainText("Guest");
    await hostPage.locator("#start-game-btn").click();

    await expect(hostPage.locator("#problem-to-golf-btn")).toBeVisible();
    await expect(guestPage.locator("#problem-to-golf-btn")).toBeVisible();

    await hostPage.locator("#problem-to-golf-btn").click();
    await expect(hostPage.locator("#golf-screen")).toBeVisible();
    await expect(hostPage.locator("#course-name")).toContainText(firstCourse.name);
    await expect(hostPage.locator("#course-name")).toContainText("Course 1/2");

    await playCourseSinkPlan(hostPage, firstCourse.id);

    await expect(hostPage.locator("#course-name")).toContainText(firstCourse.name);
    await expect(hostPage.locator("#golf-controls-panel")).toContainText("Viewing course 1/2");
    await expect(hostPage.locator("#golf-controls-panel")).toContainText("Active course 2/2");
    await hostPage.locator("#course-next-btn").click();
    await expect(hostPage.locator("#course-name")).toContainText(secondCourse.name);
    await expect(hostPage.locator("#course-name")).toContainText("Course 2/2");
    await expect(hostPage.locator("#golf-controls-panel")).toContainText("Viewing course 2/2");

    await guestPage.locator("#problem-to-golf-btn").click();
    await expect(guestPage.locator("#golf-screen")).toBeVisible();
    await expect(guestPage.locator("#course-name")).toContainText(firstCourse.name);
    await expect(guestPage.locator("#course-name")).toContainText("Course 1/2");
    await expect(guestPage.locator("#golf-controls-panel")).toContainText("Viewing course 1/2");
    await guestPage.locator("#course-next-btn").click();
    await expect(guestPage.locator("#course-name")).toContainText(secondCourse.name);
    await expect(guestPage.locator("#course-name")).toContainText("Course 2/2");
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});

test("player-choice mode lets players switch between per-difficulty question tracks", async ({ page }) => {
  await createRoom(page, {
    name: "Host",
    difficultyMode: "player-choice"
  });

  await page.locator("#start-game-btn").click();
  await expect(page.locator("#problem-difficulty-select")).toBeVisible();
  await expect(page.locator("#problem-panel")).toContainText("1 swing credit");

  const easyTitle = (await page.locator("#problem-panel h2").textContent())?.trim();
  if (!easyTitle) {
    throw new Error("Expected an easy question title.");
  }

  await page.locator("#problem-difficulty-select").selectOption("medium");
  await expect(page.locator("#problem-panel")).toContainText("3 swing credits");

  const mediumTitle = (await page.locator("#problem-panel h2").textContent())?.trim();
  expect(mediumTitle).toBeTruthy();
  expect(mediumTitle).not.toBe(easyTitle);

  await page.locator("#problem-difficulty-select").selectOption("easy");
  await expect(page.locator("#problem-panel h2")).toHaveText(easyTitle);
});

test("multi-course rooms keep the selected course order in the lobby and on the course", async ({ page }) => {
  const [firstCourse, secondCourse] = requireCourseSummaries(2);

  await createRoom(page, {
    name: "Host",
    courseIds: [firstCourse.id, secondCourse.id]
  });

  await expect(page.locator("#waiting-settings")).toContainText("2 courses");
  await expect(page.locator("#waiting-settings")).toContainText(`1. ${firstCourse.name}`);
  await expect(page.locator("#waiting-settings")).toContainText(`2. ${secondCourse.name}`);

  await page.locator("#start-game-btn").click();
  await page.locator("#problem-to-golf-btn").click();
  await expect(page.locator("#course-name")).toContainText(firstCourse.name);
  await expect(page.locator("#course-name")).toContainText("Course 1/2");
});
