const courseCatalog = [
    {
      id: "sandy-isle",
      name: "Sandy Isle",
      description: "Course featuring many places to get stuck in sand.",
      width: 960,
      height: 540,
      tee: { x: 137, y: 411 },
      hole: { x: 853, y: 75, radius: 18 },
      walls: [
      { x: 720, y: 45, width: 35, height: 105 },
      { x: 690, y: 220, width: 120, height: 25 },
      { x: 125, y: 275, width: 125, height: 25 },
      { x: 325, y: 250, width: 25, height: 150 },
      { x: 520, y: 240, width: 60, height: 60 },
      { x: 125, y: 125, width: 30, height: 105 },
      { x: 575, y: 0, width: 25, height: 75 },
      { x: 630, y: 430, width: 40, height: 110 },
      { x: 870, y: 290, width: 33, height: 123, angle: 30 }
    ],
      sandTraps: [
      { x: 411, y: 76, width: 150, height: 75 },
      { x: 470, y: 405, width: 120, height: 50 },
      { x: 800, y: 125, width: 30, height: 75 },
      { x: 205, y: 465, width: 115, height: 55 },
      { x: 900, y: 25, width: 50, height: 140 },
      { x: 10, y: 20, width: 110, height: 112 }
    ],
      waterHazards: [],
      accents: [
      { x: 170, y: 90, width: 100, height: 50 },
      { x: 720, y: 425, width: 110, height: 45 },
      { x: 600, y: 25, width: 50, height: 15 },
      { x: 100, y: 375, width: 75, height: 70 },
      { x: 605, y: 180, width: 70, height: 45 }
    ],
      speedBoosts: []
    },
    {
      id: "water-world",
      name: "Water World",
      description: "A map with lots of water.",
      width: 1080,
      height: 450,
      tee: { x: 157, y: 200 },
      hole: { x: 910, y: 230, radius: 18 },
      walls: [
      { x: 775, y: 50, width: 175, height: 25 },
      { x: 780, y: 350, width: 175, height: 25 },
      { x: 40, y: 100, width: 30, height: 200 },
      { x: 40, y: 100, width: 200, height: 30 },
      { x: 40, y: 270, width: 200, height: 30 },
      { x: 530, y: 180, width: 50, height: 100 },
      { x: 501, y: 21, width: 50, height: 60 },
      { x: 410, y: 330, width: 80, height: 29 }
    ],
      sandTraps: [],
      waterHazards: [
      { x: 955, y: 155, width: 65, height: 145 },
      { x: 719, y: 1, width: 275, height: 45 },
      { x: 300, y: 0, width: 100, height: 100 },
      { x: 630, y: 170, width: 60, height: 60 },
      { x: 60, y: 370, width: 80, height: 40 },
      { x: 60, y: 40, width: 130, height: 30 },
      { x: 250, y: 340, width: 140, height: 70 },
      { x: 790, y: 180, width: 50, height: 110 },
      { x: 590, y: 60, width: 135, height: 38 },
      { x: 0, y: 0, width: 20, height: 450 },
      { x: 10, y: 0, width: 1070, height: 20 },
      { x: 1060, y: 10, width: 20, height: 440 },
      { x: 0, y: 430, width: 1080, height: 20 },
      { x: 550, y: 360, width: 160, height: 90 },
      { x: 420, y: 180, width: 40, height: 90 }
    ],
      accents: [
      { x: 860, y: 180, width: 90, height: 100 }
    ],
      speedBoosts: []
    },
    {
      id: "lagoon-link",
      name: "Lagoon Link",
      description: "A course with a massive water lagoon in the center.",
      width: 1240,
      height: 460,
      tee: { x: 70, y: 400 },
      hole: { x: 1110, y: 110, radius: 18 },
      walls: [
      { x: 390, y: 0, width: 30, height: 150 },
      { x: 220, y: 230, width: 30, height: 150 },
      { x: 390, y: 210, width: 110, height: 30 },
      { x: 860, y: 0, width: 150, height: 50 },
      { x: 600, y: 220, width: 140, height: 30 },
      { x: 1100, y: 340, width: 120, height: 100 },
      { x: 990, y: 150, width: 30, height: 170 },
      { x: 220, y: 370, width: 130, height: 70 },
      { x: 0, y: 440, width: 1230, height: 20 },
      { x: 1220, y: 440, width: 20, height: 20 },
      { x: 0, y: 0, width: 20, height: 460 },
      { x: 0, y: 0, width: 1240, height: 20 },
      { x: 1220, y: 0, width: 20, height: 460 },
      { x: 782, y: 69, width: 102, height: 24, angle: 30 },
      { x: 120, y: 90, width: 34, height: 101, angle: 60 }
    ],
      sandTraps: [
      { x: 280, y: 40, width: 80, height: 50 },
      { x: 170, y: 110, width: 90, height: 40 },
      { x: 490, y: 30, width: 80, height: 40 },
      { x: 640, y: 320, width: 110, height: 60 }
    ],
      waterHazards: [
      { x: 550, y: 120, width: 180, height: 80 },
      { x: 690, y: 170, width: 110, height: 70 },
      { x: 580, y: 90, width: 100, height: 50 },
      { x: 650, y: 190, width: 60, height: 40 },
      { x: 760, y: 200, width: 60, height: 60 },
      { x: 850, y: 220, width: 120, height: 50 },
      { x: 780, y: 180, width: 120, height: 60 },
      { x: 800, y: 230, width: 90, height: 40 },
      { x: 590, y: 190, width: 100, height: 30 },
      { x: 690, y: 120, width: 100, height: 70 },
      { x: 770, y: 150, width: 90, height: 50 },
      { x: 570, y: 190, width: 70, height: 50 },
      { x: 510, y: 200, width: 80, height: 70 },
      { x: 510, y: 180, width: 70, height: 40 },
      { x: 530, y: 340, width: 60, height: 90 },
      { x: 547, y: 382, width: 70, height: 50, angle: 30 },
      { x: 570, y: 370, width: 200, height: 70 },
      { x: 730, y: 360, width: 60, height: 80 },
      { x: 770, y: 340, width: 60, height: 70 },
      { x: 840, y: 370, width: 100, height: 50, angle: 120 }
    ],
      accents: [
      { x: 40, y: 40, width: 70, height: 30 },
      { x: 1060, y: 50, width: 110, height: 130 }
    ],
      speedBoosts: []
    }
];

export const COURSE_CATALOG = courseCatalog;

function cloneRectangle(rect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    ...(rect.angle ? { angle: rect.angle } : {}),
    ...(rect.strength ? { strength: rect.strength } : {})
  };
}

function cloneRectangles(rectangles = []) {
  return rectangles.map(cloneRectangle);
}

function cloneCourse(course) {
  return {
    id: course.id,
    name: course.name,
    description: course.description,
    width: course.width,
    height: course.height,
    tee: {
      x: course.tee.x,
      y: course.tee.y
    },
    hole: {
      x: course.hole.x,
      y: course.hole.y,
      radius: course.hole.radius
    },
    walls: cloneRectangles(course.walls),
    sandTraps: cloneRectangles(course.sandTraps),
    waterHazards: cloneRectangles(course.waterHazards ?? course.water),
    accents: cloneRectangles(course.accents),
    speedBoosts: cloneRectangles(course.speedBoosts)
  };
}

export function getCourseById(courseId) {
  return courseCatalog.find((course) => course.id === courseId) ?? courseCatalog[0];
}

export function getCourseCatalog() {
  return courseCatalog.map(cloneCourse);
}

export function getCourseSummaries() {
  return courseCatalog.map(({ id, name, description }) => ({
    id,
    name,
    description
  }));
}
