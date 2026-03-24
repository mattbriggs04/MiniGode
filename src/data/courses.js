const courseCatalog = [
  {
    id: "sunset-switchbacks",
    name: "Sunset Switchbacks",
    description: "A single serpentine lane with bounce walls and soft sand pockets.",
    width: 960,
    height: 540,
    tee: { x: 96, y: 448 },
    hole: { x: 854, y: 106, radius: 18 },
    walls: [
      { x: 210, y: 0, width: 28, height: 344 },
      { x: 392, y: 196, width: 28, height: 344 },
      { x: 574, y: 0, width: 28, height: 344 },
      { x: 756, y: 196, width: 28, height: 344 }
    ],
    sandTraps: [
      { x: 112, y: 328, width: 118, height: 90 },
      { x: 454, y: 72, width: 138, height: 94 },
      { x: 700, y: 344, width: 132, height: 96 }
    ],
    accents: [
      { x: 54, y: 58, width: 152, height: 54 },
      { x: 808, y: 438, width: 96, height: 42 }
    ]
  },
  {
    id: "meadow-run",
    name: "Meadow Run",
    description: "A clean, open fairway for quick multiplayer testing and one-shot experiments.",
    width: 960,
    height: 540,
    tee: { x: 122, y: 270 },
    hole: { x: 838, y: 270, radius: 18 },
    walls: [],
    sandTraps: [
      { x: 206, y: 114, width: 148, height: 82 },
      { x: 576, y: 344, width: 166, height: 84 }
    ],
    accents: [
      { x: 104, y: 72, width: 136, height: 42 },
      { x: 716, y: 420, width: 132, height: 44 }
    ]
  },
  {
    id: "copper-canyon",
    name: "Copper Canyon",
    description: "A tighter canyon with staggered barricades, forcing bank shots and patient power.",
    width: 960,
    height: 540,
    tee: { x: 92, y: 438 },
    hole: { x: 852, y: 112, radius: 18 },
    walls: [
      { x: 166, y: 112, width: 202, height: 26 },
      { x: 166, y: 112, width: 26, height: 256 },
      { x: 354, y: 256, width: 196, height: 26 },
      { x: 524, y: 72, width: 26, height: 210 },
      { x: 602, y: 198, width: 196, height: 26 },
      { x: 772, y: 198, width: 26, height: 224 }
    ],
    sandTraps: [
      { x: 80, y: 286, width: 120, height: 88 },
      { x: 388, y: 336, width: 150, height: 88 },
      { x: 670, y: 70, width: 130, height: 86 }
    ],
    accents: [
      { x: 70, y: 54, width: 144, height: 52 },
      { x: 438, y: 90, width: 112, height: 44 },
      { x: 806, y: 420, width: 84, height: 40 }
    ]
  },
  {
    id: "sandy-isle",
    name: "Sandy Isle",
    description: "Course featuring many places to get stuck in sand.",
    width: 960,
    height: 540,
    tee: {
      x: 137,
      y: 411
    },
    hole: {
      x: 853,
      y: 75,
      radius: 18
    },
    walls: [
      {
        x: 720,
        y: 45,
        width: 35,
        height: 105
      },
      {
        x: 745,
        y: 220,
        width: 120,
        height: 25
      },
      {
        x: 125,
        y: 275,
        width: 125,
        height: 25
      },
      {
        x: 325,
        y: 250,
        width: 25,
        height: 150
      },
      {
        x: 520,
        y: 240,
        width: 60,
        height: 60
      },
      {
        x: 125,
        y: 125,
        width: 30,
        height: 105
      },
      {
        x: 575,
        y: 0,
        width: 25,
        height: 75
      },
      {
        x: 630,
        y: 430,
        width: 40,
        height: 110
      }
    ],
    sandTraps: [
      {
        x: 411,
        y: 76,
        width: 150,
        height: 75
      },
      {
        x: 470,
        y: 405,
        width: 120,
        height: 50
      },
      {
        x: 800,
        y: 125,
        width: 30,
        height: 75
      },
      {
        x: 205,
        y: 465,
        width: 115,
        height: 55
      },
      {
        x: 900,
        y: 25,
        width: 50,
        height: 140
      }
    ],
    accents: [
      {
        x: 165,
        y: 90,
        width: 100,
        height: 50
      },
      {
        x: 720,
        y: 425,
        width: 110,
        height: 45
      },
      {
        x: 600,
        y: 25,
        width: 50,
        height: 15
      },
      {
        x: 100,
        y: 375,
        width: 75,
        height: 70
      },
      {
        x: 605,
        y: 180,
        width: 70,
        height: 45
      }
    ]
  }
  {
    id: "water-world",
    name: "Water World",
    description: "A map with lots of water.",
    width: 1080,
    height: 450,
    tee: {
      x: 157,
      y: 200
    },
    hole: {
      x: 908,
      y: 235,
      radius: 18
    },
    walls: [
      {
        x: 775,
        y: 50,
        width: 175,
        height: 25
      },
      {
        x: 773,
        y: 323,
        width: 175,
        height: 25
      },
      {
        x: 40,
        y: 100,
        width: 30,
        height: 200
      },
      {
        x: 40,
        y: 100,
        width: 200,
        height: 30
      },
      {
        x: 40,
        y: 270,
        width: 200,
        height: 30
      },
      {
        x: 500,
        y: 150,
        width: 50,
        height: 100
      },
      {
        x: 400,
        y: 320,
        width: 40,
        height: 40
      },
      {
        x: 470,
        y: 20,
        width: 50,
        height: 60
      }
    ],
    sandTraps: [],
    waterHazards: [
      {
        x: 955,
        y: 155,
        width: 65,
        height: 145
      },
      {
        x: 675,
        y: 0,
        width: 275,
        height: 45
      },
      {
        x: 350,
        y: 50,
        width: 100,
        height: 100
      },
      {
        x: 630,
        y: 240,
        width: 60,
        height: 60
      },
      {
        x: 440,
        y: 330,
        width: 110,
        height: 70
      },
      {
        x: 60,
        y: 370,
        width: 80,
        height: 40
      },
      {
        x: 60,
        y: 40,
        width: 130,
        height: 30
      },
      {
        x: 310,
        y: 210,
        width: 50,
        height: 40
      },
      {
        x: 250,
        y: 340,
        width: 140,
        height: 70
      },
      {
        x: 690,
        y: 370,
        width: 90,
        height: 70
      },
      {
        x: 630,
        y: 80,
        width: 90,
        height: 70
      },
      {
        x: 790,
        y: 170,
        width: 50,
        height: 110
      }
    ],
    accents: [
      {
        x: 860,
        y: 180,
        width: 90,
        height: 100
      }
    ]
  }
];

export const COURSE_CATALOG = courseCatalog;

function cloneRectangle(rect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
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
    accents: cloneRectangles(course.accents)
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
