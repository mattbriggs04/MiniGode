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
  }
];

export const COURSE_CATALOG = courseCatalog;

export function getCourseById(courseId) {
  return courseCatalog.find((course) => course.id === courseId) ?? courseCatalog[0];
}

export function getCourseSummaries() {
  return courseCatalog.map(({ id, name, description }) => ({
    id,
    name,
    description
  }));
}
