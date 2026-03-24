import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function createRoom(page, {
  name,
  difficultyMode = "fixed",
  difficulty = "easy",
  questionSource = "local",
  courseCount = 1,
  courseId = "sunset-switchbacks",
  courseIds = null
}) {
  await page.goto("/");
  await page.locator('#landing-tab-create').click();
  await page.locator('#create-form input[name="name"]').fill(name);
  await page.locator("#create-difficulty-mode").selectOption(difficultyMode);
  if (difficultyMode === "fixed") {
    await page.locator("#create-difficulty").selectOption(difficulty);
  }
  await page.locator("#create-question-source").selectOption(questionSource);
  await page.locator("#create-course-count").selectOption(String(courseCount));

  const orderedCourseIds = courseIds ?? (courseId ? [courseId] : null);
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

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
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

test("first finisher becomes a spectator while other players keep the hole active", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    const roomCode = await createRoom(hostPage, {
      name: "dev$mode!",
      courseId: "meadow-run"
    });
    await joinRoom(guestPage, { roomCode, name: "Guest" });

    await expect(hostPage.locator("#waiting-player-list")).toContainText("Guest");
    await hostPage.locator("#start-game-btn").click();

    await expect(hostPage.locator("#problem-to-golf-btn")).toBeVisible();
    await expect(guestPage.locator("#problem-to-golf-btn")).toBeVisible();

    await hostPage.locator("#problem-to-golf-btn").click();
    await expect(hostPage.locator("#golf-screen")).toBeVisible();

    await setRangeValue(hostPage, "#angle-input", 359);
    await setRangeValue(hostPage, "#power-input", 80);
    await hostPage.locator("#swing-btn").click();

    await expect(hostPage.locator("#golf-controls-panel")).toContainText("You set the pace.");
    await expect(hostPage.locator("#golf-controls-panel")).toContainText("Watch the rest of the course");
    await expect(hostPage.locator("#swing-btn")).toBeHidden();

    await expect(guestPage.locator("#problem-panel")).toContainText("dev$mode! finished first.");
    await expect(guestPage.locator("#problem-panel")).toContainText("Still playing");
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

test("multi-course rooms keep the selected course order", async ({ page }) => {
  await createRoom(page, {
    name: "Host",
    courseCount: 2,
    courseIds: ["meadow-run", "copper-canyon"]
  });

  await expect(page.locator("#waiting-settings")).toContainText("2 courses");
  await expect(page.locator("#waiting-settings")).toContainText("1. Meadow Run");
  await expect(page.locator("#waiting-settings")).toContainText("2. Copper Canyon");

  await page.locator("#start-game-btn").click();
  await page.locator("#problem-to-golf-btn").click();
  await expect(page.locator("#course-name")).toContainText("Meadow Run");
  await expect(page.locator("#course-name")).toContainText("Course 1/2");
});
