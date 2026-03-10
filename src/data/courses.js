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
